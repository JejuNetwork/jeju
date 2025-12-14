# @jejunetwork/cli

Development toolchain for Jeju Network.

## Installation

```bash
# Global install
bun install -g @jejunetwork/cli

# Or use directly
bunx @jejunetwork/cli
npx @jejunetwork/cli
```

## Commands

```bash
jeju dev              # Start development environment
jeju test             # Run test suite
jeju deploy testnet   # Deploy to testnet
jeju deploy mainnet   # Deploy to mainnet
jeju init my-agent    # Create new project
jeju keys             # Key management
jeju status           # Check system status
```

That's it. **6 commands**.

## Development

```bash
# Start full environment (chain + contracts + apps)
jeju dev

# Localnet only (no apps)
jeju dev --minimal

# Start specific apps
jeju dev --only=gateway,bazaar

# Stop
jeju dev --stop
# Or just Ctrl+C
```

## Testing

```bash
# Run all tests
jeju test

# Specific phase
jeju test --phase=contracts
jeju test --phase=e2e
jeju test --phase=wallet

# CI mode
jeju test --ci
```

## Keys & Genesis Ceremony

```bash
# Show keys
jeju keys

# Check balances
jeju keys balance

# Genesis ceremony for production (secure key generation)
jeju keys genesis -n testnet
jeju keys genesis -n mainnet

# TEE ceremony (maximum security)
jeju keys tee -n mainnet
jeju keys genesis -n mainnet --tee
```

### Local Ceremony

For testnet or when TEE is not available:

1. Security checklist (offline machine, secure storage)
2. Choose: generate new keys OR import existing (hardware wallet)
3. Entropy collection (random typing + timing)
4. Password encryption (16+ chars, mixed case, numbers, symbols)
5. Key display with confirmation
6. Encrypted storage + memory clearing

### TEE Ceremony (Recommended for Mainnet)

Runs the ceremony inside a Trusted Execution Environment:

```bash
# Using Phala Network (public TEE infrastructure)
jeju keys tee -n mainnet --endpoint https://your-app.phala.network

# Using GCP Confidential VM
jeju keys tee -n mainnet --endpoint https://your-cvm-ip:8090

# Local dstack simulator (testing only)
DSTACK_SIMULATOR_ENDPOINT=http://localhost:8090 jeju keys tee -n testnet
```

**TEE Benefits:**
- Keys derived from hardware-rooted secrets
- Never exist outside the enclave
- Cryptographic attestation proves genuine TEE
- Tamper-proof and auditable

**Verify Attestation:**

```bash
jeju keys tee --verify ~/.jeju/keys/mainnet/attestation.json
```

### Distributed Ceremony (Maximum Trustlessness)

For production mainnet with the highest security guarantees:

```bash
# Interactive setup with 3 TEE providers
jeju keys distributed -n mainnet -t 2

# With provider config file
jeju keys distributed -n mainnet -t 2 --providers providers.json

# Register on-chain for public auditability
jeju keys distributed -n mainnet -t 2 --register
```

**providers.json:**
```json
[
  { "name": "phala-1", "type": "phala", "endpoint": "https://app1.phala.network" },
  { "name": "gcp-1", "type": "gcp", "endpoint": "https://gcp-cvm.example.com" },
  { "name": "azure-1", "type": "azure", "endpoint": "https://azure-cvm.example.com" }
]
```

**How it works:**

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   TEE 1 (Phala) │  │   TEE 2 (GCP)   │  │   TEE 3 (Azure) │
│   Key Share 1   │  │   Key Share 2   │  │   Key Share 3   │
│   Attestation   │  │   Attestation   │  │   Attestation   │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                   Distributed Key Generation
                   (FROST/GG20 protocol)
                              │
                   ┌──────────┴──────────┐
                   │   Aggregated        │
                   │   Public Keys       │
                   │   (no single party  │
                   │    has full key)    │
                   └─────────────────────┘
```

**Security properties:**
- **k-of-n threshold**: Need k TEEs to sign, any k-1 is useless
- **No single point of trust**: No human or TEE has complete key
- **Cross-verification**: Each TEE verifies others' attestations
- **Collusion-resistant**: Even if ALL humans collude, cannot reconstruct
- **On-chain auditability**: Register ceremony for public verification

### Key Burning

```bash
# Permanently delete keys
jeju keys burn -n testnet
```

## Deployment

```bash
# Deploy to testnet
jeju deploy testnet

# Deploy to mainnet
jeju deploy mainnet

# Deploy only contracts
jeju deploy testnet --contracts

# Dry run
jeju deploy testnet --dry-run
```

## Project Initialization

```bash
# Interactive
jeju init my-app

# With type
jeju init my-agent --type=agent
jeju init my-dapp --type=dapp
jeju init my-service --type=service
```

## Status & Diagnostics

```bash
# Quick status
jeju status

# Full system check
jeju status --check
```

## Integration with Monorepo

The root `package.json` includes:

```bash
bun run jeju:dev      # Same as: jeju dev
bun run jeju:test     # Same as: jeju test
bun run jeju:deploy   # Same as: jeju deploy
```

## License

MIT
