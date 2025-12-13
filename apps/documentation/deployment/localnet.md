# Localnet Deployment

Run a complete Jeju environment locally for development.

## Quick Start

```bash
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash

cd jeju
bun install
bun run dev
```

## What Starts

### Chain Infrastructure

L1 RPC (Geth) runs on port 8545 for Ethereum execution. L1 Beacon runs on port 4000 for Ethereum consensus. L2 RPC (op-reth) runs on port 9545 for Jeju execution. L2 WebSocket runs on port 9546 for Jeju subscriptions. Additional services include op-node (L2 consensus), op-batcher (transaction batching), and op-proposer (state root posting).

### Applications

Gateway on port 4001, Bazaar on port 4006, Compute on port 4007, and Storage on port 4010 all auto-start. Indexer on port 4350 and Docs on port 4004 do not auto-start.

### Pre-deployed Contracts

All core contracts are deployed automatically: JejuToken and ERC20Factory, IdentityRegistry and BanManager, MultiTokenPaymaster and PaymasterFactory, OIF contracts (InputSettler, OutputSettler, SolverRegistry), and Uniswap V4 periphery.

## Commands

```bash
bun run dev                  # Full environment (chain + apps)
bun run dev -- --minimal     # Chain only (faster startup)
bun run localnet:stop        # Stop everything
bun run localnet:reset       # Reset to fresh state

# View status
kurtosis enclave inspect jeju-localnet
kurtosis service logs jeju-localnet el-1-op-reth-op-node

# Port management
bun run ports                # Check port usage
bun run cleanup              # Kill processes on ports
```

## Configuration

### Environment Variables

Create `.env.local` for local overrides:

```bash
GATEWAY_PORT=5001
L2_RPC_PORT=8545
ENABLE_INDEXER=true
ENABLE_MONITORING=true
```

### Network Configuration

Localnet uses `packages/config/chain/localnet.json`:

```json
{
  "chainId": 1337,
  "rpcUrl": "http://127.0.0.1:9545",
  "wsUrl": "ws://127.0.0.1:9546",
  "l1": {
    "chainId": 900,
    "rpcUrl": "http://127.0.0.1:8545"
  }
}
```

## Test Accounts

The Deployer at `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, User 1 at `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, and User 2 at `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` are all pre-funded with 10,000 ETH each. See [Test Accounts](/getting-started/test-accounts) for the full list.

## Deploy Your Contracts

```bash
cd packages/contracts

forge create src/MyContract.sol:MyContract \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Or via script
forge script script/DeployMyContract.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Troubleshooting

**Docker Not Running**: On macOS run `open -a Docker`. On Linux run `sudo systemctl start docker`.

**Port Already in Use**: Run `lsof -i :9545` to find the process, then `kill -9 <PID>` to stop it, or run `bun run cleanup`.

**Enclave Fails to Start**: Run `kurtosis clean -a` to clean all enclaves, then retry with `bun run dev`.

**Out of Disk Space**: Run `docker system prune -a` and `kurtosis clean -a`.

## Development Workflow

1. Start localnet with `bun run dev`
2. Deploy contract with `forge script script/MyScript.s.sol --broadcast`
3. Test in browser at http://127.0.0.1:4001
4. Run tests with `bun run test`
5. Stop with `Ctrl+C` or `bun run localnet:stop`
