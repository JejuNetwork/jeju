/**
 * Bridge module exports
 *
 * Cross-chain token bridging via Hyperlane warp routes.
 * For EVM↔EVM bridging, use HyperlaneAdapter.
 * For Solana bridging, use SolanaAdapter (or @jejunetwork/zksolbridge for ZK proofs).
 */

export * from './hyperlane-adapter'
export * from './solana-adapter'
