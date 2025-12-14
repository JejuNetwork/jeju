# @jejunetwork/cli

Development, testing, and deployment for Jeju Network.

## Requirements

- **Bun** >= 1.0.0
- Docker (for indexer)
- Foundry (for contracts)

## Install

```bash
bun install -g @jejunetwork/cli
```

## Commands

```
Development:
  jeju dev              Start localnet + apps
  jeju dev --minimal    Localnet only
  jeju status           Check what is running

Testing:
  jeju test             Run all tests
  jeju test --phase=contracts   Forge tests
  jeju test --app=wallet        Test specific app

Accounts:
  jeju keys             Show keys
  jeju fund             Show balances
  jeju fund 0x...       Fund address
  jeju fund --all       Fund all dev accounts

Deploy:
  jeju keys genesis     Generate production keys
  jeju deploy testnet   Deploy to testnet
  jeju deploy mainnet   Deploy to mainnet
```

---

## Development

```bash
# Start everything
jeju dev

# Just the chain
jeju dev --minimal

# Stop
jeju dev --stop
```

---

## Testing

```bash
# All tests
jeju test

# Solidity contracts only
jeju test --phase=contracts

# TypeScript only
jeju test --phase=unit

# Specific app
jeju test --app=wallet

# CI mode
jeju test --ci
```

---

## Accounts

```bash
# Show dev keys
jeju keys

# Show balances
jeju fund

# Fund an address
jeju fund 0x1234... -a 50

# Fund all dev accounts
jeju fund --all
```

---

## Production Keys

```bash
# Local ceremony
jeju keys genesis -n mainnet

# TEE ceremony (hardware enclave)
jeju keys tee -n mainnet

# Multi-TEE (max security)
jeju keys distributed -n mainnet
```

---

## Deploy

```bash
jeju deploy testnet
jeju deploy mainnet
jeju deploy testnet --dry-run
```

---

## Monorepo

```bash
bun run jeju:dev
bun run jeju:test
bun run jeju:deploy
```

---

## License

MIT
