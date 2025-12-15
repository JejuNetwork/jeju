# Deploy Scripts

Deployment scripts for various Jeju Network components.

## Primary Usage

Use the Jeju CLI for most deployments:

```bash
jeju deploy testnet --token        # Deploy JejuToken
jeju deploy mainnet --token --safe 0x...
jeju deploy verify testnet         # Verify on explorer
jeju deploy check testnet          # Check on-chain state
```

## Direct Script Usage

For specific component deployments:

```bash
# Token & Core
bun run scripts/deploy/token.ts --network testnet
bun run scripts/deploy/testnet.ts
bun run scripts/deploy/mainnet.ts

# Infrastructure
bun run scripts/deploy/account-abstraction.ts
bun run scripts/deploy/eil.ts
bun run scripts/deploy/eil-paymaster.ts

# Protocols
bun run scripts/deploy/oif.ts localnet
bun run scripts/deploy/defi-protocols.ts
bun run scripts/deploy/jns.ts

# DAO & Governance
bun run scripts/deploy/dao.ts
bun run scripts/deploy/governance.ts
bun run scripts/deploy/council.ts
```

## Scripts

| Script | Description |
|--------|-------------|
| `token.ts` | JejuToken + BanManager deployment |
| `testnet.ts` | Full testnet deployment |
| `mainnet.ts` | Production deployment |
| `account-abstraction.ts` | AA infrastructure |
| `eil.ts` | Ethereum Intent Layer |
| `eil-paymaster.ts` | EIL Paymaster |
| `oif.ts` | Oracle Integration Framework |
| `oif-multichain.ts` | Multi-chain OIF |
| `defi-protocols.ts` | DeFi protocol setup |
| `jns.ts` | Jeju Name Service |
| `dao.ts` | DAO contracts |
| `governance.ts` | Governance setup |
| `council.ts` | Council deployment |
| `launchpad.ts` | Token launchpad |
| `oracle.ts` | Oracle network |
| `otc.ts` | OTC trading |
| `generate-operator-keys.ts` | Generate operator keys |
