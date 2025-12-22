# CLI

Development and deployment CLI for Jeju.

## Install

```bash
bun install -g @jejunetwork/cli
```

Or use from monorepo:

```bash
bun run jeju <command>
```

## Commands

### Development

```bash
jeju dev              # Start localnet + apps
jeju dev --minimal    # Chain only
jeju dev --stop       # Stop everything
jeju status           # Check what's running
```

### Testing

```bash
jeju test                    # All tests
jeju test --phase=contracts  # Forge tests only
jeju test --phase=unit       # TypeScript only
jeju test --app=wallet       # Specific app
jeju test --ci               # CI mode
```

### Accounts

```bash
jeju keys                    # Show dev keys
jeju fund                    # Show balances
jeju fund 0x... -a 50        # Fund address with 50 ETH
jeju fund --all              # Fund all dev accounts
```

### Deployment

```bash
jeju deploy testnet          # Deploy to testnet
jeju deploy mainnet          # Deploy to mainnet
jeju deploy testnet --dry-run
```

### Key Generation

```bash
jeju keys genesis -n mainnet     # Local key ceremony
jeju keys tee -n mainnet         # TEE ceremony
jeju keys distributed -n mainnet # Multi-TEE ceremony
```

## From Monorepo

```bash
bun run jeju:dev
bun run jeju:test
bun run jeju:deploy
```

## Environment

The CLI reads from `.env` in the current directory:

```bash
PRIVATE_KEY=0x...
RPC_URL=http://127.0.0.1:9545
NETWORK=localnet  # localnet | testnet | mainnet
```

---

<details>
<summary>📋 Copy as Context</summary>

```
@jejunetwork/cli

Install: bun install -g @jejunetwork/cli

Commands:
- jeju dev: Start localnet + apps
- jeju dev --minimal: Chain only
- jeju test: Run all tests
- jeju test --phase=contracts: Forge tests
- jeju keys: Show dev keys
- jeju fund 0x... -a 50: Fund address
- jeju deploy testnet: Deploy

From monorepo: bun run jeju:dev
```

</details>
