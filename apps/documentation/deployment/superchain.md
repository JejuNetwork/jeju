# Superchain Integration

How to join the OP Superchain and integrate with the Jeju Federation.

## Overview

Jeju is designed to be both:
1. **OP Superchain compatible** - Can join the official Optimism Superchain
2. **Jeju Federation ready** - Cross-chain interop with all Jeju networks

## Superchain Requirements

### Technical Requirements

| Requirement | Jeju Status | Notes |
|-------------|-------------|-------|
| OP Stack contracts | ✅ Complete | Standard deployment |
| L2ToL2CrossDomainMessenger | ✅ Preinstall | Automatic with OP Stack |
| Shared sequencer support | ✅ Ready | Via op-node configuration |
| 7-day upgrade timelock | ⚠️ Configure | Required for mainnet |
| Security Council multisig | ⚠️ Configure | Required for governance |
| Fault proofs | ✅ Complete | op-challenger deployed |

### Governance Requirements

1. **Upgrade Delay**: 7+ days for contract upgrades
2. **Security Council**: 4/7 multisig for emergency actions
3. **Governance Token**: Optional but recommended
4. **Bug Bounty**: Required program with adequate funding

## Joining the Superchain

### Step 1: Deploy Standard OP Stack

```bash
# Use Jeju's deployment scripts
jeju deploy mainnet --superchain

# This ensures:
# - Standard bridge contracts
# - L2ToL2CrossDomainMessenger preinstall
# - Fault proof contracts
# - Proper security configuration
```

### Step 2: Configure Shared Sequencing

Edit your `op-node` configuration:

```yaml
# op-node.yaml
sequencer:
  enabled: true
  l1-beacon: https://beacon.ethereum.org
  
# Enable cross-chain messaging
interop:
  enabled: true
  dependency-set: "superchain-mainnet"
```

### Step 3: Register with Superchain Registry

```bash
# Submit to Superchain registry
jeju superchain register \
  --chain-id 420691 \
  --name "Jeju Network" \
  --rpc https://rpc.jeju.network \
  --explorer https://explorer.jeju.network
```

### Step 4: Apply to Optimism Foundation

1. Fill out the [Superchain Application](https://optimism.io/superchain)
2. Complete security audit
3. Demonstrate governance setup
4. Join governance calls

## Cross-Chain Messaging

### L2ToL2CrossDomainMessenger

The standard way to send messages between Superchain L2s:

```solidity
// Sending a message to another L2
IL2ToL2CrossDomainMessenger messenger = IL2ToL2CrossDomainMessenger(
    0x4200000000000000000000000000000000000023  // Preinstall address
);

messenger.sendMessage(
    destinationChainId,
    targetContract,
    abi.encodeCall(ITarget.handleMessage, (data))
);
```

```solidity
// Receiving a message
function handleMessage(bytes calldata data) external {
    require(
        msg.sender == address(0x4200000000000000000000000000000000000023),
        "Only messenger"
    );
    // Process message
}
```

### Jeju Federation Messaging

For networks not in the Superchain, use Jeju's HyperlaneOracle:

```solidity
// Cross-chain attestation via Hyperlane
IHyperlaneOracle oracle = IHyperlaneOracle(oracleAddress);

// Check if an order was filled on another chain
bool filled = oracle.isAttested(orderId);
```

## Trust Tiers

Networks in the Jeju Federation have different trust levels:

| Tier | Stake | Capabilities |
|------|-------|--------------|
| UNSTAKED | 0 ETH | Listed in registry, no consensus |
| STAKED | 1+ ETH | Federation consensus, cross-chain intents |
| VERIFIED | 10+ ETH | Full trust, sequencer eligible |

### Capabilities by Tier

**UNSTAKED Networks:**
- ❌ Cannot participate in federation voting
- ❌ Cannot run shared sequencer
- ❌ Cannot receive delegated liquidity
- ✅ Can be listed in registry
- ✅ Can use OIF for cross-chain intents (user pays)

**STAKED Networks:**
- ✅ Federation consensus participation
- ✅ Cross-chain identity verification
- ✅ Solver network access
- ✅ Delegated liquidity (with collateral)
- ❌ Cannot run shared sequencer

**VERIFIED Networks:**
- ✅ All STAKED capabilities
- ✅ Sequencer rotation eligibility
- ✅ Priority in solver routing
- ✅ Governance voting rights

## Contracts

### Superchain Standard

```
L1 (Ethereum):
├── OptimismPortal.sol         # Deposits/withdrawals
├── L2OutputOracle.sol         # State commitments
├── SystemConfig.sol           # Chain parameters
└── DisputeGameFactory.sol     # Fault proofs

L2 (Jeju):
├── L2CrossDomainMessenger.sol # Standard messaging
├── L2ToL2CrossDomainMessenger.sol # Superchain interop
├── L2StandardBridge.sol       # Token bridging
└── GasPriceOracle.sol         # L1 fee calculation
```

### Jeju Federation

```
L1 Hub (Ethereum):
├── NetworkRegistry.sol        # All Jeju networks
├── RegistryHub.sol           # Meta-registry
├── FederatedIdentity.sol     # Cross-chain identity
├── FederatedLiquidity.sol    # Cross-chain liquidity
└── FederatedSolver.sol       # Solver coordination

Each L2:
├── IdentityRegistry.sol      # ERC-8004
├── SolverRegistry.sol        # Local solvers
├── InputSettler.sol          # Intent creation
├── OutputSettler.sol         # Intent fulfillment
└── HyperlaneOracle.sol       # Cross-chain attestation
```

## Integration Checklist

### For Superchain

- [ ] Deploy standard OP Stack contracts
- [ ] Configure 7-day upgrade timelock
- [ ] Set up Security Council multisig
- [ ] Enable L2ToL2CrossDomainMessenger
- [ ] Submit Superchain application
- [ ] Complete governance onboarding

### For Jeju Federation

- [ ] Register in NetworkRegistry (1+ ETH stake recommended)
- [ ] Deploy IdentityRegistry
- [ ] Deploy SolverRegistry
- [ ] Configure HyperlaneOracle
- [ ] Register registries in RegistryHub
- [ ] Enable cross-chain identity federation

## CLI Commands

```bash
# Check Superchain compatibility
jeju superchain check

# Register with federation
jeju federation join --stake 1

# Check federation status
jeju federation status

# List all federated networks
jeju federation list

# Verify cross-chain identity
jeju federation verify-identity <address> --chain <chainId>
```

## FAQ

### Can I be in both Superchain and Jeju Federation?

Yes! They're complementary:
- Superchain: Shared sequencing, fast L2-to-L2 messaging
- Jeju Federation: Cross-ecosystem interop, Solana support, AI agent identity

### What if I don't stake?

Unstaked networks are still listed and can use basic cross-chain features, but:
- Other networks won't accept your votes
- Solvers may deprioritize your intents
- No access to delegated liquidity

### How do I upgrade my trust tier?

```bash
# Add stake to your network
jeju federation add-stake --amount 1

# Request verification (requires 10 ETH + governance approval)
jeju federation request-verification
```

## Resources

- [OP Stack Documentation](https://docs.optimism.io/stack)
- [Superchain Registry](https://github.com/ethereum-optimism/superchain-registry)
- [Jeju Federation Contracts](/contracts/overview)
- [Cross-Chain Intents](/learn/intents)

