# @jejunetwork/zksolbridge

Trustless Solana↔EVM bridge using ZK Light Client verification. No validators, no multisigs, just cryptographic proofs.

## Why ZK for Solana?

| Bridge Type | EVM↔EVM | EVM↔Solana |
|-------------|---------|------------|
| **Hyperlane** | ✅ Fast, cheap, battle-tested | ⚠️ Limited support |
| **ZK Light Client** | Overkill (use Hyperlane) | ✅ Only trustless option |

**This package is specifically for Solana connections.** For EVM-to-EVM bridging, use Hyperlane via `@jejunetwork/token`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    JEJU CROSS-CHAIN INFRASTRUCTURE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  EVM ←────────────────→ EVM         Use @jejunetwork/token (Hyperlane)         │
│        Fast (3-5 min)                                                    │
│        Validator security                                                │
│                                                                          │
│  EVM ←────────────────→ Solana      Use @jejunetwork/zksolbridge (this pkg)    │
│        Trustless (10-15 min)                                             │
│        ZK proof security                                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## ZK Light Client Flow

```
┌─────────────────┐                           ┌─────────────────┐
│   EVM Chains    │◄─────── Relayer ─────────►│     Solana      │
│ (ETH/Base/Arb/  │         Service           │                 │
│  OP/BSC/Jeju)   │                           │                 │
└────────┬────────┘                           └────────┬────────┘
         │                                             │
┌────────▼────────┐      ┌─────────────┐      ┌────────▼────────┐
│ Solana Light    │◄─────│   SP1       │─────►│ EVM Light       │
│ Client (ZK)     │      │   Prover    │      │ Client (ZK)     │
│ • Groth16       │      │   Service   │      │ • BN254         │
│ • Consensus     │      │             │      │ • Sync Cmte     │
└─────────────────┘      └─────────────┘      └─────────────────┘
                                │
┌───────────────────────────────┴───────────────────────────────┐
│                         ZK Circuits (SP1)                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Ed25519    │  │ Solana     │  │ Ethereum   │  │ Transfer │ │
│  │ Batch Sig  │  │ Consensus  │  │ Consensus  │  │ Inclusion│ │
└──┴────────────┴──┴────────────┴──┴────────────┴──┴──────────┴─┘
```

## Features

- **Trustless**: No validators, multisigs, or trusted parties
- **Bidirectional**: EVM→Solana and Solana→EVM
- **ZK Light Clients**: Cryptographic verification of consensus
- **TEE Batching**: Efficient proof aggregation
- **Self-Hosted**: Run your own proving infrastructure

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Foundry](https://getfoundry.sh) (for EVM contracts)
- [Anchor](https://www.anchor-lang.com) (for Solana programs)
- [SP1](https://docs.succinct.xyz) (for ZK proving)

### Installation

```bash
cd packages/bridge
bun install
```

### Build ZK Circuits

```bash
# Install SP1 toolchain
bun run setup:sp1

# Build circuits
bun run build:circuits
```

### Local Development

```bash
# Start local EVM (Anvil) + Solana Test Validator
bun run local:start

# Deploy contracts
bun run deploy:local

# Run the relayer
bun run relayer
```

### Testnet

```bash
bun run deploy:testnet
bun run relayer --mode testnet
```

## Transfer Performance

| Route | Time | Security Model |
|-------|------|----------------|
| EVM → Solana | ~10-15 min | ZK proof of EVM sync committee |
| Solana → EVM | ~10-15 min | ZK proof of Solana consensus |

## Configuration

### Environment Variables

```bash
# EVM RPC endpoints
ETH_RPC_URL=https://eth.llamarpc.com
BASE_RPC_URL=https://mainnet.base.org

# Solana RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Prover
PROVER_MODE=self-hosted  # or 'succinct-network'
PROVER_WORKERS=4

# TEE (optional)
TEE_ENDPOINT=http://localhost:8080/tee
```

## File Structure

```
packages/bridge/
├── circuits/                 # SP1 ZK circuits
│   ├── solana-consensus/     # Solana Tower BFT proof
│   ├── ethereum/             # Ethereum sync committee proof
│   ├── token-transfer/       # Transfer inclusion proof
│   └── ed25519/              # Signature batch verification
├── contracts/                # Solidity contracts
│   ├── bridges/              # Light client & bridge
│   ├── verifiers/            # Groth16 verifier
│   └── tokens/               # Cross-chain token
├── programs/                 # Solana Anchor programs
│   ├── evm-light-client/     # Ethereum light client
│   └── token-bridge/         # Token bridge program
├── src/                      # TypeScript SDK
│   ├── clients/              # EVM & Solana clients
│   ├── prover/               # SP1 integration
│   ├── tee/                  # TEE batching
│   ├── relayer/              # Orchestration
│   └── monitoring/           # Health & metrics
└── config/                   # Network configs
```

## Security

- **ZK Proofs**: All state transitions verified cryptographically
- **Light Clients**: No trusted intermediaries
- **Replay Protection**: Nonces prevent double-spending
- **TEE Attestation**: Optional batch verification

## Related Packages

- `@jejunetwork/token` - EVM↔EVM bridging via Hyperlane warp routes
- `packages/contracts/src/oif/` - Cross-chain OIF with Hyperlane oracle option
