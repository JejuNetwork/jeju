# Jeju L2 Contracts

Smart contracts for the Jeju L2 network, including the ELIZAOS token and Paymaster for gasless transactions.

## Contracts

### ELIZAOS (`src/ELIZAOS.sol`)
ERC20 token representing ELIZAOS on the Jeju L2 network.

- **Name**: ELIZAOS
- **Symbol**: ELIZAOS
- **Decimals**: 18
- **Initial Supply**: 1 billion tokens

### ELIZAOSPaymaster (`src/ELIZAOSPaymaster.sol`)
ERC-4337 Paymaster that allows agents to pay for gas using ELIZAOS tokens instead of ETH.

See [docs/PAYMASTER.md](docs/PAYMASTER.md) for detailed documentation.

## Setup

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies (if any)
forge install

# Build contracts
forge build
```

## Deployment

### Prerequisites
- L2 RPC URL
- Deployer private key with ETH on L2
- ERC-4337 EntryPoint address (pre-deployed on Jeju L2)

### Deploy

```bash
# Set environment variables
export L2_RPC_URL="http://your-l2-node:9545"
export DEPLOYER_KEY="0x..."
export ENTRYPOINT_ADDRESS="0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"

# Deploy ELIZAOS
forge create src/ELIZAOS.sol:ELIZAOS \
  --rpc-url $L2_RPC_URL \
  --private-key $DEPLOYER_KEY \
  --broadcast

# Note the deployed address, then deploy Paymaster
export ELIZAOS_ADDRESS="0x..."

forge create src/ELIZAOSPaymaster.sol:ELIZAOSPaymaster \
  --rpc-url $L2_RPC_URL \
  --private-key $DEPLOYER_KEY \
  --constructor-args $ENTRYPOINT_ADDRESS $ELIZAOS_ADDRESS \
  --broadcast
```

## Pre-deployed Addresses on Jeju L2

| Contract | Address |
|----------|---------|
| EntryPoint v0.6.0 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| EntryPoint v0.7.0 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| DeterministicDeploymentProxy | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` |

## Testing

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-contract ELIZAOSPaymasterTest
```

## License

MIT
