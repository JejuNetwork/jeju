# Jeju Network Smart Contracts

Complete smart contract system for Jeju, including paymaster, liquidity management, price oracles, and ERC-8004 service registry.

## Quick Start

```bash
# Build contracts
cd contracts
forge build

# Run all tests
forge test

# Run registry tests specifically
make test-registry

# Deploy to localnet
make deploy-local
```

## Contract System

### Paymaster System
- **ElizaOSToken**: ERC-20 fee payment token (with 10B supply cap)
- **LiquidityPaymaster**: ERC-4337 paymaster for gasless transactions
- **LiquidityVault**: Dual-pool liquidity management (ETH + elizaOS)
- **FeeDistributor**: 50/50 fee split (apps + LPs)
- **ManualPriceOracle**: elizaOS/ETH price feed

### ERC-8004 Registry System
- **IdentityRegistry**: Service/application registration (ERC-721 NFTs)
- **ReputationRegistry**: Feedback and reputation tracking
- **ValidationRegistry**: TEE attestation and multi-validator verification

### Supporting Contracts
- **SimpleGame**: Example integration showing revenue earning
- **CrossChainPriceRelay**: Future V2 cross-chain oracle

## Testing

### Run All Tests (173 tests)

```bash
forge test
```

### Run Registry Tests Only (73 tests)

```bash
make test-registry
# or
forge test --match-contract ".*Registry.*"
```

### Test Breakdown

| Test Suite | Tests | Purpose |
|------------|-------|---------|
| IdentityRegistry | 18 | Service registration, metadata, NFT |
| ReputationRegistry | 24 | Feedback, signatures, TEE attestation |
| ValidationRegistry | 24 | Validation requests, TEE providers |
| RegistryIntegration | 7 | Multi-registry workflows |
| LiquiditySystem | 4 | Paymaster integration |
| LiquidityVault | 15 | Liquidity pools |
| FeeDistributor | 6 | Fee distribution |
| ManualPriceOracle | 9 | Price oracle |
| Other | 66 | Various components |
| **TOTAL** | **173** | **100% Passing** |

### Run From Project Root

```bash
# Run complete test suite (contracts + config + utils)
./scripts/run-all-tests.sh
# Runs 282 total tests including 173 contract tests
```

## Deployment

### Localnet

```bash
# Using Makefile
make deploy-local

# Or using forge directly
forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url http://localhost:8545 \
  --broadcast
```

Deploys all 9 contracts:
1. EntryPoint (mock for local)
2. elizaOS Token
3. Price Oracle
4. Liquidity Vault
5. Fee Distributor
6. Liquidity Paymaster
7. Identity Registry
8. Reputation Registry
9. Validation Registry

### Testnet

```bash
export NETWORK=testnet
export DEPLOYER_PRIVATE_KEY=0x...

forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url https://rpc.testnet.jeju.network \
  --broadcast \
  --verify
```

### Mainnet

```bash
export NETWORK=mainnet
export DEPLOYER_PRIVATE_KEY=0x...

forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url https://rpc.mainnet.jeju.network \
  --broadcast \
  --verify
```

## Registry Web Viewer

Browse registered services with the web interface:

```bash
cd web
python3 -m http.server 3000
# Open http://localhost:3000/registry-viewer.html
```

Features:
- View all registered services
- Browse metadata
- Check reputation scores
- See validation status
- Multi-network support

## Development

### Build

```bash
forge build
```

### Test

```bash
# All tests
forge test

# Specific test file
forge test --match-path test/IdentityRegistry.t.sol

# Specific test
forge test --match-test testRegisterWithMetadata

# With gas reporting
forge test --gas-report

# With verbosity
forge test -vvv
```

### Clean

```bash
forge clean
```

## Makefile Commands

```bash
make help            # Show all available commands
make build           # Compile contracts
make test            # Run all tests
make test-registry   # Run registry tests (73)
make test-all        # Run with gas report
make clean           # Clean build artifacts
make deploy-local    # Deploy to localnet
```

## Contract Addresses

After deployment, addresses are saved to:
- `deployments/localnet/liquidity-system.json`
- `deployments/testnet/liquidity-system.json`
- `deployments/mainnet/liquidity-system.json`

## Documentation

- **Quick Start**: `../REGISTRY_QUICKSTART.md`
- **Complete Guide**: `../documentation/registry.md`
- **Technical Docs**: `src/registry/README.md`
- **Web Viewer**: `web/README.md`
- **Test Plan**: `test/REGISTRY_TEST_PLAN.md`
- **Coverage Report**: `test/COVERAGE_VERIFICATION.md`

## Use Cases

### TEE Attestation
Services can request TEE validation from SGX/SEV/TrustZone providers and display trust badges.

### Service Discovery
Users can discover services by type, reputation, and validation status.

### Application Identity
DeFi protocols, APIs, games, and oracles register as NFTs with transferable ownership.

### Revenue Earning
Services earn fees through the paymaster system automatically.

## Security

All contracts have been:
- ✅ Thoroughly tested (173 tests, 100% pass rate)
- ✅ Security reviewed (0 vulnerabilities found)
- ✅ Documented with NatSpec
- ✅ Updated to Solidity 0.8.28
- ✅ Optimized for gas efficiency

## Support

- Discord: https://discord.gg/jeju
- Docs: https://docs.jeju.network
- Security: security@jeju.network

## License

MIT
