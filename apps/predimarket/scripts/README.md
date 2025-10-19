# Predimarket Deployment Scripts

Scripts for deploying and verifying the Predimarket prediction market platform.

## Scripts

### `deploy.ts`

Deploys the complete Predimarket system to a target network.

**Usage:**
```bash
# Deploy to localnet
NETWORK=local bun run vendor/predimarket/scripts/deploy.ts

# Deploy to testnet
NETWORK=testnet PRIVATE_KEY=0x... bun run vendor/predimarket/scripts/deploy.ts

# Deploy to mainnet
NETWORK=mainnet PRIVATE_KEY=0x... bun run vendor/predimarket/scripts/deploy.ts
```

**Features:**
- Network detection and validation
- Dependency checking
- Pre-deployment validation (gas estimates, balance checks)
- Post-deployment verification
- Support for upgrading existing deployments

### `verify.ts`

Verifies deployed Predimarket contracts.

**Usage:**
```bash
NETWORK=testnet bun run vendor/predimarket/scripts/verify.ts
```

**Checks:**
- Contract deployment verification
- Token contract validation
- Oracle integration
- Permissions and ownership
- Functional tests (market creation, betting, resolution)

## Configuration

Set environment variables in `.env`:

```bash
PRIVATE_KEY=0x...
NETWORK=testnet  # or mainnet, local
JEJU_RPC_URL=https://testnet-rpc.jeju.network
ELIZAOS_TOKEN_ADDRESS=0x...
```

## See Also

- Main Predimarket README: `vendor/predimarket/README.md`
- Deployment documentation: `apps/documentation/deployment/predimarket-*.md`

