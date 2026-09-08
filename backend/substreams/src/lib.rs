//! Sybil Shield Substreams — Backend-Suganthan.md Phase 9.
//!
//! Emits real-time funding evidence: ERC-20 `Transfer` logs and native-value
//! transfers, filtered to a watch list supplied as a module parameter.
//!
//! SCOPE IS DELIBERATELY NARROW. The spec is explicit: "Don't reimplement the
//! risk engine inside the module." This decodes and filters. Clustering,
//! feature extraction and scoring stay in TypeScript where they are testable
//! and where a policy change does not mean recompiling WASM and resyncing.
//!
//! WHY BOTH FEEDS. A funder bankrolling a Sybil cluster usually sends plain ETH
//! for gas. That emits no log, so a pipeline watching only `Transfer` logs is
//! blind to the most common funding pattern. Phase 3's Token API client learned
//! the same lesson; this keeps the streaming path consistent with it.

mod pb {
    include!(concat!(env!("OUT_DIR"), "/sybil_shield.v1.rs"));
}

use pb::{Erc20Transfer, FundingTransfers, NativeTransfer};
use substreams::errors::Error;
use substreams::scalar::BigInt;
use substreams::Hex;
use substreams_ethereum::pb::eth::v2 as eth;

substreams_ethereum::init!();

/// `keccak256("Transfer(address,address,uint256)")`.
///
/// Not invented — this is the canonical ERC-20 Transfer topic0, and it matches
/// the value published in pinax-network/substreams-evm.
const TRANSFER_TOPIC0: [u8; 32] =
    hex_literal::hex!("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");

/// Lower-cased `0x`-prefixed hex, the one address spelling used everywhere.
///
/// The TypeScript normalizer lower-cases too, so a wallet can never appear
/// under two spellings and split into two rows of evidence.
fn addr(bytes: &[u8]) -> String {
    format!("0x{}", Hex(bytes).to_string().to_lowercase())
}

/// The watch list, parsed from the module parameter.
///
/// Config, never a hardcoded address list (Section 0.2 rule 1). Changing which
/// campaign is being watched is a parameter change, not a recompile.
///
/// An EMPTY watch list means "emit everything". That is correct for a short
/// backfill range but ruinous at head — every ERC-20 transfer on Ethereum. The
/// caller is expected to pass a list; `substreams.yaml` documents this.
struct WatchList {
    addresses: Vec<String>,
}

impl WatchList {
    fn parse(params: &str) -> Self {
        let addresses = params
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        Self { addresses }
    }

    fn is_empty(&self) -> bool {
        self.addresses.is_empty()
    }

    /// True when any of the supplied addresses is being watched.
    ///
    /// Checks every participant — sender, recipient and token contract — because
    /// funding evidence needs the transfer whether the watched wallet is the one
    /// paying or the one being paid.
    fn matches(&self, candidates: &[&str]) -> bool {
        if self.is_empty() {
            return true;
        }
        candidates
            .iter()
            .any(|c| self.addresses.iter().any(|w| w == c))
    }
}

/// Decoded ERC-20 `Transfer` logs and native transfers for one block.
#[substreams::handlers::map]
fn map_funding_transfers(params: String, blk: eth::Block) -> Result<FundingTransfers, Error> {
    let watch = WatchList::parse(&params);
    let block_number = blk.number;
    let timestamp = blk
        .header
        .as_ref()
        .and_then(|h| h.timestamp.as_ref())
        .map(|t| t.seconds as u64)
        .unwrap_or_default();

    let mut erc20 = Vec::new();
    let mut native = Vec::new();

    for view in blk.logs() {
        let log = view.log;

        // Cheapest rejections first: a Transfer has exactly 3 topics (the
        // signature plus two indexed addresses) and a 32-byte value payload.
        if log.topics.len() != 3 || log.topics[0] != TRANSFER_TOPIC0 {
            continue;
        }
        if log.data.len() < 32 {
            continue;
        }

        // Indexed address params are right-aligned in their 32-byte topic slot.
        let from = addr(&log.topics[1][12..]);
        let to = addr(&log.topics[2][12..]);
        let contract = addr(&log.address);

        if !watch.matches(&[&from, &to, &contract]) {
            continue;
        }

        erc20.push(Erc20Transfer {
            block_number,
            timestamp,
            tx_hash: format!("0x{}", Hex(&view.receipt.transaction.hash).to_string()),
            log_index: log.block_index,
            contract,
            from,
            to,
            // uint256 -> decimal string. Never a u64: an 18-decimal token
            // overflows 64 bits at about 18.4 whole tokens.
            value: BigInt::from_unsigned_bytes_be(&log.data[0..32]).to_string(),
        });
    }

    for (index, trace) in blk.transaction_traces.iter().enumerate() {
        // status 1 = SUCCEEDED. A reverted transaction moved no value, and
        // recording it as funding evidence would invent a relationship.
        if trace.status != 1 {
            continue;
        }

        let value = trace
            .value
            .as_ref()
            .map(|v| BigInt::from_unsigned_bytes_be(&v.bytes))
            .unwrap_or_else(|| BigInt::zero());
        if value.is_zero() {
            continue;
        }

        let from = addr(&trace.from);
        let to = addr(&trace.to);
        if !watch.matches(&[&from, &to]) {
            continue;
        }

        native.push(NativeTransfer {
            block_number,
            timestamp,
            tx_hash: format!("0x{}", Hex(&trace.hash).to_string()),
            transaction_index: index as u32,
            from,
            to,
            value: value.to_string(),
        });
    }

    Ok(FundingTransfers {
        block_number,
        timestamp,
        erc20,
        native,
    })
}
