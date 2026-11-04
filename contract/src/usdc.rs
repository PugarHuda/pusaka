//! Verified USDC: a Pusaka's ERC-20 USDC deposits on chains NEAR MPC can read, attested by the
//! MPC network's foreign-transaction verification (domain 3, `verify_foreign_transaction`).
//!
//! The contract computes the hash of the exact facts it expects (this Transfer log, in this tx,
//! finalized on this chain) and passes it as `expected_payload_hash`; the MPC contract answers
//! with the payload hash it signed, which the callback compares. Encoding:
//! sha256(borsh(ForeignTxSignPayload::V1 { request, values })) from near/mpc
//! crates/near-mpc-contract-interface/src/types/foreign_chain.rs.

use near_sdk::env;

/// keccak256("Transfer(address,address,uint256)")
pub const TRANSFER_TOPIC: &str = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/// (EVM chain id, ForeignChainRpcRequest variant, its borsh index, Circle's USDC on that chain).
/// Only chains the MPC network verifies (`get_available_foreign_chains`); Ethereum L1 isn't one.
#[cfg(not(feature = "mainnet"))]
pub const CHAINS: [(u64, &str, u8, &str); 2] = [
    (84532, "Base", 6, "036cbd53842c5426634e7929541ec2318f3dcf7e"),
    (421614, "Arbitrum", 7, "75faf114eafb1bdbe2f0316df893fd58ce46aa4d"),
];
#[cfg(feature = "mainnet")]
pub const CHAINS: [(u64, &str, u8, &str); 2] = [
    (8453, "Base", 6, "833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    (42161, "Arbitrum", 7, "af88d065e77c8cc2239327c5edb3a432268e5831"),
];

pub fn chain(chain_id: u64) -> Option<(u64, &'static str, u8, &'static str)> {
    CHAINS.iter().copied().find(|c| c.0 == chain_id)
}

/// An EVM log as the MPC extracts it (`EvmLog`). `data` is the RPC's 0x-prefixed lower-case hex.
pub struct Log {
    pub tx: [u8; 32],
    pub log_index: u64,
    pub tx_index: u64,
    pub block_hash: [u8; 32],
    pub block_number: u64,
    pub address: [u8; 20],
    pub data: String,
    pub topics: Vec<[u8; 32]>,
}

/// sha256 of ForeignTxSignPayload::V1 { request: <chain>(EvmRpcRequest { tx_id, [Log{log_index}], Finalized }),
/// values: [EvmExtractedValue(Log(log))] }.
pub fn payload_hash(chain_index: u8, log: &Log) -> [u8; 32] {
    let mut b = vec![0u8, chain_index]; // ForeignTxSignPayload::V1, ForeignChainRpcRequest::<chain>
    b.extend_from_slice(&log.tx);
    b.extend_from_slice(&1u32.to_le_bytes()); // one extractor
    b.push(1); // EvmExtractor::Log
    b.extend_from_slice(&log.log_index.to_le_bytes());
    b.push(2); // EvmFinality::Finalized
    b.extend_from_slice(&1u32.to_le_bytes()); // one value
    b.push(1); // ExtractedValue::EvmExtractedValue
    b.push(1); // EvmExtractedValue::Log
    b.push(0); // removed: false
    b.extend_from_slice(&log.log_index.to_le_bytes());
    b.extend_from_slice(&log.tx_index.to_le_bytes());
    b.extend_from_slice(&log.tx);
    b.extend_from_slice(&log.block_hash);
    b.extend_from_slice(&log.block_number.to_le_bytes());
    b.extend_from_slice(&log.address);
    b.extend_from_slice(&(log.data.len() as u32).to_le_bytes());
    b.extend_from_slice(log.data.as_bytes());
    b.extend_from_slice(&(log.topics.len() as u32).to_le_bytes());
    for t in &log.topics {
        b.extend_from_slice(t);
    }
    env::sha256_array(&b)
}

pub fn hex32(s: &str, what: &str) -> [u8; 32] {
    let v = hex::decode(s.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str(&format!("{what}: not hex")));
    v.try_into().unwrap_or_else(|_| env::panic_str(&format!("{what}: expected 32 bytes")))
}

/// The amount of a Transfer log: its 32-byte data word, which must fit u128 (USDC has 6 decimals).
pub fn amount(data: &str) -> u128 {
    near_sdk::require!(data.len() == 66 && data.starts_with("0x") && data[2..].bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)), "data: 0x + 64 lower-case hex");
    let word = hex32(data, "data");
    near_sdk::require!(word[..16].iter().all(|&b| b == 0), "amount too large");
    u128::from_be_bytes(word[16..].try_into().unwrap())
}
