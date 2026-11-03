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

pub fn sha256d(data: &[u8]) -> [u8; 32] {
    env::sha256_array(&env::sha256_array(data))
}

fn varint(b: &[u8], i: &mut usize) -> u64 {
    let first = b[*i];
    *i += 1;
    let n = match first {
        0xfd => 2,
        0xfe => 4,
        0xff => 8,
        x => return x as u64,
    };
    let mut v = 0u64;
    for k in 0..n {
        v |= (b[*i + k] as u64) << (8 * k);
    }
    *i += n;
    v
}

/// (value, scriptPubKey) of output `vout` in a non-witness serialized transaction.
/// Panics on malformed input or a SegWit-serialized transaction.
pub fn output(tx: &[u8], vout: u32) -> (u64, Vec<u8>) {
    assert!(tx.len() > 10, "tx too short");
    assert!(!(tx[4] == 0 && tx[5] == 1), "send the non-witness serialization (txid preimage)");
    let mut i = 4;
    let n_in = varint(tx, &mut i);
    for _ in 0..n_in {
        i += 36;
        let len = varint(tx, &mut i) as usize;
        i += len + 4;
    }
    let n_out = varint(tx, &mut i);
    assert!((vout as u64) < n_out, "vout out of range");
    for k in 0..n_out {
        let value = u64::from_le_bytes(tx[i..i + 8].try_into().unwrap());
        i += 8;
        let len = varint(tx, &mut i) as usize;
        let script = tx[i..i + len].to_vec();
        i += len;
        if k == vout as u64 {
            return (value, script);
        }
    }
    unreachable!()
}

fn display_hash(h: &str) -> [u8; 32] {
    let mut b: [u8; 32] = hex::decode(h).expect("bad hash hex").try_into().expect("hash must be 32 bytes");
    b.reverse(); // explorer order -> internal order, which the light client stores
    b
}

/// Borsh encoding of the light client's `ProofArgsV2`.
pub fn proof_args_borsh(
    txid_internal: &[u8; 32],
    block_hash: &str,
    tx_index: u64,
    merkle_proof: &[String],
    coinbase_txid: &str,
    coinbase_merkle_proof: &[String],
    confirmations: u64,
) -> Vec<u8> {
    let mut out = Vec::new();
    let vec = |out: &mut Vec<u8>, hs: &[String]| {
        out.extend_from_slice(&(hs.len() as u32).to_le_bytes());
        for h in hs {
            out.extend_from_slice(&display_hash(h));
        }
    };
    out.extend_from_slice(txid_internal);
    out.extend_from_slice(&display_hash(block_hash));
    out.extend_from_slice(&tx_index.to_le_bytes());
    vec(&mut out, merkle_proof);
    out.extend_from_slice(&display_hash(coinbase_txid));
    vec(&mut out, coinbase_merkle_proof);
    out.extend_from_slice(&confirmations.to_le_bytes());
    out
}

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
