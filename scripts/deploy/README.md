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
bun run scripts/deploy/oif-multichain.ts --testnet
bun run scripts/deploy/defi-protocols.ts
bun run scripts/deploy/jns.ts

# x402 & Commerce (NEW)
bun run scripts/deploy/x402-multichain.ts --testnet
bun run scripts/deploy/x402-multichain.ts --mainnet --verify

# DAO & Governance
bun run scripts/deploy/dao.ts
bun run scripts/deploy/governance.ts
bun run scripts/deploy/council.ts
```

---

## Coinbase Ecosystem Deployments

### x402 Micropayments Protocol

Deploy the x402 payment facilitator to multiple chains:

```bash
# Check available chains and balances
bun run scripts/deploy/x402-multichain.ts

# Deploy to all testnets
bun run scripts/deploy/x402-multichain.ts --testnet

# Deploy to a specific chain
bun run scripts/deploy/x402-multichain.ts --chain 84532  # Base Sepolia

# Deploy to mainnet with verification
bun run scripts/deploy/x402-multichain.ts --mainnet --verify
```

**Environment Variables:**
```bash
DEPLOYER_PRIVATE_KEY=0x...       # Required
FEE_RECIPIENT=0x...              # Treasury address for protocol fees
TREASURY_ADDRESS=0x...           # Alternative to FEE_RECIPIENT
```

**Funding Requirements (per chain):**

| Network | Min ETH Required | Estimated Cost |
|---------|-----------------|----------------|
| Jeju Testnet | 0.01 ETH | ~$0.03 |
| Base Sepolia | 0.01 ETH | ~$0.03 |
| Sepolia | 0.05 ETH | ~$0.15 |
| Arbitrum Sepolia | 0.01 ETH | ~$0.03 |
| Optimism Sepolia | 0.01 ETH | ~$0.03 |
| **Testnet Total** | **~0.09 ETH** | **~$0.27** |
| Base Mainnet | 0.05 ETH | ~$150 |
| Ethereum Mainnet | 0.2 ETH | ~$600 |
| Arbitrum One | 0.02 ETH | ~$60 |
| Optimism | 0.02 ETH | ~$60 |
| **Mainnet Total** | **~0.3 ETH** | **~$870** |

### Commerce Protocol (Authorize & Capture)

Deploy Coinbase Commerce escrow contracts:

```bash
cd packages/contracts

# Base Sepolia
forge script script/DeployCommerce.s.sol --rpc-url https://sepolia.base.org --broadcast

# Base Mainnet  
forge script script/DeployCommerce.s.sol --rpc-url https://mainnet.base.org --broadcast --verify
```

**Environment Variables:**
```bash
PRIVATE_KEY=0x...
FEE_RECIPIENT=0x...              # Operator fee recipient
OPERATOR_FEE_BPS=100             # 1% operator fee (default)
SUPPORTED_TOKENS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
```

**Funding Requirements:**

| Network | Min ETH Required |
|---------|-----------------|
| Base Sepolia | 0.01 ETH |
| Base Mainnet | 0.03 ETH |

---

## Farcaster Hub Deployment

Deploy a permissionless Farcaster Hub (Hubble) node:

```bash
# Deploy via Helm
cd packages/deployment/kubernetes/helm/farcaster-hubble

# Testnet hub
helm install farcaster-hub . -f values.yaml --set config.network=mainnet

# With custom storage class
helm install farcaster-hub . --set persistence.storageClass=gp3
```

**Infrastructure Requirements:**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| Memory | 8 GB | 16 GB |
| Storage | 500 GB SSD | 1 TB NVMe |
| Network | 100 Mbps | 1 Gbps |

**Monthly Cost Estimate:**

| Cloud Provider | Instance | Est. Cost/mo |
|---------------|----------|--------------|
| AWS | r6i.xlarge + 500GB gp3 | ~$250 |
| GCP | n2-highmem-4 + 500GB SSD | ~$280 |
| Self-hosted | Dedicated server | ~$100 |

---

## Solver Capital Requirements

For OIF (Open Intent Framework) solvers that fill cross-chain intents:

**Capital Allocation Recommendations:**

| Tier | Capital | Max Intent Size | Est. Monthly Revenue |
|------|---------|-----------------|---------------------|
| Starter | 1 ETH (~$3,000) | 0.5 ETH | $50-200 |
| Standard | 5 ETH (~$15,000) | 2.5 ETH | $300-1,000 |
| Professional | 20 ETH (~$60,000) | 10 ETH | $1,500-5,000 |

**Benefits by Tier:**

- **Starter**: Fill small retail intents, low risk, learn the system
- **Standard**: Fill most intents, better profit margins, MEV protection worth it
- **Professional**: Priority routing, fill large intents, partnership opportunities

**Configure Solver:**
```bash
# Edit values
vi packages/deployment/kubernetes/helm/solver/values-jeju.yaml

# Deploy
helm install solver ./solver -f values-jeju.yaml
```

---

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
| `x402-multichain.ts` | x402 Payment Protocol (multi-chain) |
| `defi-protocols.ts` | DeFi protocol setup |
| `jns.ts` | Jeju Name Service |
| `dao.ts` | DAO contracts |
| `governance.ts` | Governance setup |
| `council.ts` | Council deployment |
| `launchpad.ts` | Token launchpad |
| `oracle.ts` | Oracle network |
| `otc.ts` | OTC trading |
| `generate-operator-keys.ts` | Generate operator keys |

---

## Post-Deployment Checklist

After deploying contracts:

1. **Update contracts.json**: Run deployment script - it updates `packages/config/contracts.json` automatically
2. **Verify on Explorer**: Use `--verify` flag or manually verify via Etherscan/Basescan
3. **Configure Services**:
   - Update Helm values with deployed addresses
   - Set environment variables in Kubernetes secrets
4. **Test Integration**:
   ```bash
   # Test x402 payment
   bun run apps/gateway/tests/x402/settlement.test.ts
   
   # Test OIF intents  
   bun run packages/contracts/test/oif/Settler.t.sol
   ```

---

## Environment Setup

Create `.env` in project root:

```bash
# Deployer
DEPLOYER_PRIVATE_KEY=0x...
DEPLOYER_ADDRESS=0x...

# Treasury
TREASURY_ADDRESS=0x...
FEE_RECIPIENT=0x...

# RPCs (optional, uses defaults if not set)
JEJU_RPC_URL=https://rpc.jejunetwork.org
JEJU_TESTNET_RPC_URL=https://testnet-rpc.jejunetwork.org
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ETHEREUM_RPC_URL=https://eth.llamarpc.com
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Farcaster (optional - uses permissionless hub if not set)
FARCASTER_HUB_URL=https://nemes.farcaster.xyz:2281
# NEYNAR_API_KEY=...  # Only if using Neynar API
```
