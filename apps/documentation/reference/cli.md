# CLI Commands

All commands use Bun and are run from the repository root.

## Development

`bun run dev` starts localnet and all apps. `bun run dev -- --minimal` starts localnet only (no apps). `bun run test` runs the test suite. `bun run build` builds all packages and apps. `bun run clean` cleans build artifacts and stops services.

## Localnet

`bun run localnet:start` starts the local chain. `bun run localnet:stop` stops the local chain. `bun run localnet:reset` resets to fresh state.

## Testing

`bun run test` runs all tests. `bun run test:core` runs core package tests. `bun run test:apps` runs application tests. `bun run test:e2e` runs end-to-end tests. `bun run test:wallet` runs wallet interaction tests. `bun run test:smoke` runs quick smoke tests.

## Contract Deployment

`bun run contracts:deploy` deploys to the current network. `bun run contracts:deploy:testnet` deploys to testnet. `bun run contracts:deploy:mainnet` deploys to mainnet.

## OIF Deployment

`bun run oif:deploy:local` deploys OIF to localnet. `bun run oif:deploy:testnet` deploys OIF to testnet. `bun run oif:deploy:mainnet` deploys OIF to mainnet. `bun run oif:verify` verifies OIF deployment.

## Infrastructure

`bun run infra:plan` runs Terraform plan. `bun run infra:apply` runs Terraform apply. `bun run k8s:deploy` deploys to Kubernetes. `bun run k8s:diff` previews Kubernetes changes. `bun run deploy:testnet` runs full testnet deployment. `bun run deploy:mainnet` runs full mainnet deployment.

## Docker

`bun run images:build` builds Docker images. `bun run images:push` pushes to registry.

## Utilities

`bun run ports` checks port usage. `bun run cleanup` kills processes on Jeju ports. `bun run wallet` shows wallet config. `bun run apps:list` lists all apps.

## Testnet Utilities

`bun run testnet:check` checks testnet readiness. `bun run testnet:keys` generates operator keys. `bun run testnet:deployer` sets up testnet deployer. `bun run testnet:fund` funds testnet deployer. `bun run testnet:bridge` bridges tokens to testnet.

## Vendor Apps

`bun run vendor:list` lists vendor apps. `bun run vendor:sync` clones/updates vendor apps. `bun run vendor:update` pulls latest changes. `bun run dev:vendor` starts vendor apps only.

## Verification

`bun run preflight` runs preflight checks. `bun run verify:monitoring` verifies monitoring setup. `bun run verify:security` runs security scan.

## Contract Development

From `packages/contracts`:

`forge build` compiles contracts. `forge test` runs all tests. `forge test --match-contract JejuToken` tests a specific contract. `forge test --gas-report` includes gas report. `forge script script/DeployLocalnet.s.sol --broadcast` deploys. `forge verify-contract $ADDRESS src/Contract.sol:Contract` verifies.

## App Development

From `apps/<app-name>`:

`bun install` installs dependencies. `bun run dev` starts development. `bun run build` builds for production. `bun run test` runs tests.

## Cast Commands

Common Foundry `cast` commands:

```bash
cast block latest --rpc-url $RPC
cast balance $ADDRESS --rpc-url $RPC
cast call $CONTRACT "balanceOf(address)" $USER --rpc-url $RPC
cast send $CONTRACT "transfer(address,uint256)" $TO $AMOUNT --rpc-url $RPC --private-key $PK
cast --to-wei 1 ether
cast --from-wei 1000000000000000000
cast keccak "Transfer(address,address,uint256)"
cast sig "transfer(address,uint256)"
```

## Environment Variables

Set network context with `JEJU_NETWORK=testnet bun run <command>` or override RPC with `JEJU_RPC_URL=https://custom-rpc.com bun run <command>`.
