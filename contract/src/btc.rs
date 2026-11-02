//! Bitcoin helpers: P2WPKH scripts and BIP143 sighashes, built inside the contract
//! so every MPC signature is bound to outpoints the contract has seen.

use near_sdk::env;
use omni_transaction::bitcoin::BitcoinTransaction;
use omni_transaction::bitcoin::types::{
    Amount, EcdsaSighashType, Hash, LockTime, OutPoint, ScriptBuf, Sequence, TxIn, TxOut, Txid,
    Version, Witness,
};
use omni_transaction::{TransactionBuilder, TxBuilder, BITCOIN};

pub const DUST_SAT: u64 = 546;

/// `secp256k1:<base58 of 64-byte X||Y>` (MPC `derived_public_key` format) -> 33-byte compressed key.
pub fn compress_mpc_key(s: &str) -> Vec<u8> {
    let b58 = s.strip_prefix("secp256k1:").expect("not a secp256k1 key");
    let raw = bs58::decode(b58).into_vec().expect("bad base58");
    assert_eq!(raw.len(), 64, "expected 64-byte uncompressed key");
    let mut out = Vec::with_capacity(33);
    out.push(if raw[63] & 1 == 0 { 0x02 } else { 0x03 });
    out.extend_from_slice(&raw[..32]);
    out
}

pub fn hash160(data: &[u8]) -> [u8; 20] {
    env::ripemd160_array(&env::sha256_array(data))
}

/// scriptPubKey of a P2WPKH output: OP_0 <20-byte pkh>
pub fn p2wpkh_script(pkh: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![0x00, 0x14];
    s.extend_from_slice(pkh);
    s
}

/// BIP143 scriptCode for P2WPKH: OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG
fn p2wpkh_script_code(pkh: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![0x76, 0xa9, 0x14];
    s.extend_from_slice(pkh);
    s.extend_from_slice(&[0x88, 0xac]);
    s
}

pub struct Spend {
    pub tx: BitcoinTransaction,
    /// One 32-byte sighash per input, in input order.
    pub sighashes: Vec<[u8; 32]>,
}

/// Builds a v2 tx spending `inputs` (txid in explorer/display hex, vout, value) to
/// `dest_script`, sending change back to `pkh`. Panics on bad amounts.
pub fn build_spend(
    pkh: &[u8; 20],
    inputs: &[(String, u32, u64)],
    dest_script: Vec<u8>,
    amount: u64,
    fee: u64,
) -> Spend {
    assert!(amount >= DUST_SAT, "amount below dust");
    let total: u64 = inputs.iter().map(|i| i.2).sum();
    let change = total
        .checked_sub(amount)
        .and_then(|r| r.checked_sub(fee))
        .expect("inputs do not cover amount + fee");

    let txins = inputs
        .iter()
        .map(|(txid, vout, _)| TxIn {
            previous_output: OutPoint::new(
                Txid(Hash::from_hex(txid).expect("bad txid hex")),
                *vout,
            ),
            script_sig: ScriptBuf::default(),
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
            witness: Witness::default(),
        })
        .collect();

    let mut outputs = vec![TxOut {
        value: Amount::from_sat(amount),
        script_pubkey: ScriptBuf(dest_script),
    }];
    // ponytail: change below dust is donated to the fee rather than creating an unspendable output
    if change >= DUST_SAT {
        outputs.push(TxOut {
            value: Amount::from_sat(change),
            script_pubkey: ScriptBuf(p2wpkh_script(pkh)),
        });
    }

    let tx: BitcoinTransaction = TransactionBuilder::new::<BITCOIN>()
        .version(Version::Two)
        .lock_time(LockTime::from_height(0).unwrap())
        .inputs(txins)
        .outputs(outputs)
        .build();

    let code = ScriptBuf(p2wpkh_script_code(pkh));
    let sighashes = inputs
        .iter()
        .enumerate()
        .map(|(i, input)| {
            let pre = tx.build_for_signing_segwit(EcdsaSighashType::All, i, &code, input.2);
            env::sha256_array(&env::sha256_array(&pre))
        })
        .collect();

    Spend { tx, sighashes }
}

/// Raw unsigned tx (no witnesses) as hex, for the client to attach witnesses and broadcast.
pub fn unsigned_hex(tx: &BitcoinTransaction) -> String {
    hex::encode(tx.serialize())
}
