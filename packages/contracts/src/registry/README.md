# ERC-8004 Agent Registry System

Jeju Network's implementation of the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Trustless Agent Registry standard with futarchy governance.

## Overview

The ERC-8004 registry system provides a decentralized infrastructure for AI agents to establish identity, build reputation, and get validated. It consists of four core contracts:

1. **IdentityRegistry**: Agent registration with optional staking and futarchy governance (ERC-721 based)
2. **ReputationRegistry**: Feedback and reputation tracking
3. **ValidationRegistry**: Independent validation and verification
4. **RegistryGovernance**: Futarchy-based ban/slash decisions via predimarket

## Key Features

### ✅ Permissionless Registration
- **Free Tier**: Anyone can register without stake
- **Optional Staking**: Choose from Small (.001 ETH), Medium (.01 ETH), or High (.1 ETH) tiers
- **Reputation Signal**: Higher stakes act as spam deterrent and trust signal
- **Refundable**: Voluntary de-registration refunds entire stake

### 🗳️ Futarchy Governance  
- **Community-Driven**: Anyone can propose bans/slashes (requires proposal bond)
- **Prediction Markets**: Predimarket creates conditional markets for each decision
- **Guardian System**: Weighted voting for moderators with HIGH stake
- **Multi-Sig Safety**: 1/1 localnet, 2/3 testnet, 3/5 mainnet approval required
- **Appeals**: 7-day appeal window with guardian review

## Contracts

### IdentityRegistry.sol

**Purpose**: Register agents as ERC-721 NFTs with optional staking and governance integration

**Key Features**:
- Each agent is an ERC-721 NFT (transferable, tradeable)
- Optional stake tiers: None (free), Small (.001 ETH), Medium (.01 ETH), High (.1 ETH)
- Multi-token staking support (ETH, elizaOS, CLANKER, VIRTUAL, CLANKERMON, USDC)
- On-chain key-value metadata storage
- Tag-based discovery for filtering
- Governance-controlled bans and slashing
- Appeals mechanism for unfair decisions
- Compatible with all NFT marketplaces and wallets

**Example Usage**:

```solidity
// Register for free (no stake)
uint256 agentId = identityRegistry.register("ipfs://QmYourAgentConfig");

// Or register with stake for reputation boost
IdentityRegistry.MetadataEntry[] memory metadata = new IdentityRegistry.MetadataEntry[](2);
metadata[0] = IdentityRegistry.MetadataEntry("name", abi.encode("Trading Bot"));
metadata[1] = IdentityRegistry.MetadataEntry("type", abi.encode("defi"));

uint256 stakedAgentId = identityRegistry.registerWithStake{value: 0.001 ether}(
    "ipfs://QmYourAgentConfig",
    metadata,
    IdentityRegistry.StakeTier.SMALL, // .001 ETH stake
    address(0) // ETH
);

// Upgrade stake tier later
identityRegistry.increaseStake{value: 0.009 ether}(
    stakedAgentId,
    IdentityRegistry.StakeTier.MEDIUM // Upgrade to .01 ETH
);

// Set metadata
identityRegistry.setMetadata(agentId, "model", abi.encode("GPT-5"));

// Update tags for discovery
string[] memory tags = new string[](2);
tags[0] = "defi";
tags[1] = "trading";
identityRegistry.updateTags(agentId, tags);

// Get agents by stake tier (filter high-quality agents)
uint256[] memory highStakeAgents = identityRegistry.getAgentsByTier(
    IdentityRegistry.StakeTier.HIGH,
    0,  // offset
    20  // limit
);

// Voluntary de-registration (refunds stake)
identityRegistry.withdrawStake(agentId);
```

### ReputationRegistry.sol

**Purpose**: Store and aggregate feedback for agents

**Key Features**:
- Cryptographic authorization (EIP-191/ERC-1271 signatures)
- Score-based feedback (0-100 scale)
- Tag-based categorization
- Feedback revocation
- Response threading
- On-chain aggregation

**Example Usage**:
```solidity
// Give feedback (requires signature from agent)
reputationRegistry.giveFeedback(
    agentId,
    95, // score 0-100
    bytes32("quality"),
    bytes32("fast"),
    "ipfs://feedback-details",
    keccak256("feedback-data"),
    signedAuthorization
);

// Get summary
(uint64 count, uint8 avgScore) = reputationRegistry.getSummary(
    agentId,
    new address[](0), // all clients
    bytes32(0),       // all tags
    bytes32(0)
);

// Revoke feedback
reputationRegistry.revokeFeedback(agentId, feedbackIndex);

// Append response
reputationRegistry.appendResponse(
    agentId,
    clientAddress,
    feedbackIndex,
    "ipfs://our-response",
    keccak256("response-data")
);
```

### ValidationRegistry.sol

**Purpose**: Request and record independent validations

**Key Features**:
- Validation request/response system
- Multiple responses per request (progressive validation)
- Tag-based categorization
- On-chain aggregation
- Supports various validation methods (stake, zkML, TEE)

**Example Usage**:
```solidity
// Request validation
validationRegistry.validationRequest(
    validatorAddress,
    agentId,
    "ipfs://validation-request",
    keccak256("request-data")
);

// Validator responds
validationRegistry.validationResponse(
    requestHash,
    90, // validation score 0-100
    "ipfs://validation-result",
    keccak256("result-data"),
    bytes32("approved")
);

// Get validation status
(
    address validator,
    uint256 agentId,
    uint8 response,
    bytes32 tag,
    uint256 lastUpdate
) = validationRegistry.getValidationStatus(requestHash);

// Get summary
(uint64 count, uint8 avgResponse) = validationRegistry.getSummary(
    agentId,
    new address[](0), // all validators
    bytes32(0)        // all tags
);
```

## Futarchy Governance Flow

### Ban Proposal Example

```solidity
// 1. Anyone can propose a ban (requires .01 ETH bond)
bytes32 proposalId = governance.proposeBan{value: 0.01 ether}(
    spamAgentId,
    "Agent is spamming the network with fake transactions"
);

// 2. Predimarket automatically creates two conditional markets:
//    - "Network quality improves IF we ban Agent X" 
//    - "Network quality improves IF we DON'T ban Agent X"

// 3. Community + Guardians trade on markets (7 days)

// 4. After voting period, anyone can execute if confidence threshold met
governance.executeProposal(proposalId);

// 5. Multi-sig approves (2/3 testnet, 3/5 mainnet)
governance.approveProposal(proposalId); // Called by each signer

// 6. After timelock (7 days), proposal executes automatically:
//    - Agent is banned
//    - Stake is slashed (50% treasury, 30% proposer, 20% guardians)
//    - Proposer gets bond back as reward
```

### Appeal Process

```solidity
// Agent owner can appeal within 7 days
bytes32 appealId = governance.submitAppeal{value: 0.05 ether}(
    proposalId,
    "ipfs://QmEvidenceHash" // IPFS hash of appeal evidence
);

// Guardians review and vote
governance.voteOnAppeal(appealId, true); // true = approve appeal

// If 2/3 guardians approve:
//   - Agent is unbanned
//   - Appeal bond is refunded
```

## Integration with Jeju Ecosystem

### Paymaster Integration
Agents can earn revenue through the paymaster system:

```solidity
// 1. Register with HIGH stake for maximum trust
uint256 agentId = identityRegistry.registerWithStake{value: 0.1 ether}(
    "ipfs://my-agent",
    metadata,
    IdentityRegistry.StakeTier.HIGH,
    address(0)
);

// 2. Set revenue wallet in metadata
identityRegistry.setMetadata(agentId, "revenueWallet", abi.encode(myWallet));

// 3. Users trust HIGH-stake agents → more transactions
// 4. Earn 50% of transaction fees automatically!
```

### Predimarket Reputation Oracle
Agent betting performance feeds into reputation:

```solidity
// Agents who make accurate predictions on predimarket earn reputation
// - Correct market predictions: +10 reputation
// - Incorrect predictions: -5 reputation  
// - Quality market creation: +5 reputation
// - Spam markets (flagged by governance): -20 reputation

// Reputation oracle aggregates multiple signals:
// - Market performance (40%)
// - Stake tier (20%)
// - Validation scores (20%)
// - User feedback (20%)
```

## Deployment

### Deployed Addresses

The registry is deployed as part of the liquidity system:

```bash
# Deploy everything
forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify

# Deployment includes:
# - IdentityRegistry
# - ReputationRegistry  
# - ValidationRegistry
# (plus all paymaster contracts)
```

### Standalone Deployment

Deploy only the registry system:

```solidity
// Deploy in order:
IdentityRegistry identityRegistry = new IdentityRegistry();
ReputationRegistry reputationRegistry = new ReputationRegistry(address(identityRegistry));
ValidationRegistry validationRegistry = new ValidationRegistry(address(identityRegistry));
```

## Testing

```bash
# Run all registry tests
forge test --match-path "test/*Registry*.t.sol" -vv

# Test identity registry only
forge test --match-contract IdentityRegistryTest -vv

# Test integration
forge test --match-contract RegistryIntegrationTest -vv
```

## Viewing Registered Agents

### Web Viewer

1. Start local server:
   ```bash
   cd contracts/web
   python3 -m http.server 3000
   ```

2. Open browser:
   ```
   http://localhost:3000/registry-viewer.html
   ```

3. Connect wallet and view all registered agents with their metadata

### Contract Queries

```bash
# Get total agents
cast call $IDENTITY_REGISTRY "totalAgents()"

# Get agent owner
cast call $IDENTITY_REGISTRY "ownerOf(uint256)" 1

# Get agent metadata
cast call $IDENTITY_REGISTRY "getMetadata(uint256,string)" 1 "name"
```

## Standard Compliance

Implements [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) v1.0 specification:

- ✅ Identity Registry (ERC-721 based)
- ✅ Reputation Registry (feedback system)
- ✅ Validation Registry (verification system)
- ✅ Metadata storage and retrieval
- ✅ Event emissions
- ✅ On-chain aggregation

## Security Considerations

### IdentityRegistry
- Agent NFTs are transferable (consider implications)
- Only owner/approved can set metadata
- Metadata is public and immutable once set

### ReputationRegistry  
- Requires cryptographic signatures for feedback
- Supports both EOA (EIP-191) and smart contracts (ERC-1271)
- Feedback can be revoked by client
- Anyone can append responses

### ValidationRegistry
- Only agent owner can request validation
- Only designated validator can respond
- Progressive validation supported (multiple responses)
- All data is public

## Gas Costs

Approximate gas costs on Jeju (subject to change):

| Operation | Gas | Cost @ 1 gwei |
|-----------|-----|---------------|
| Register agent (no metadata) | ~75,000 | ~$0.00008 |
| Register with metadata | ~300,000 | ~$0.0003 |
| Set metadata | ~50,000 | ~$0.00005 |
| Give feedback | ~150,000 | ~$0.00015 |
| Request validation | ~120,000 | ~$0.00012 |
| Validation response | ~80,000 | ~$0.00008 |

## Examples

### Register AI Chat Agent

```solidity
// Create agent card
string memory agentCard = uploadToIPFS({
    "name": "AI Assistant",
    "description": "Helpful AI chatbot",
    "model": "GPT-5",
    "capabilities": ["chat", "code", "analysis"]
});

// Register
uint256 agentId = identityRegistry.register(agentCard);

// Set metadata
identityRegistry.setMetadata(agentId, "name", abi.encode("AI Assistant"));
identityRegistry.setMetadata(agentId, "model", abi.encode("GPT-5"));
identityRegistry.setMetadata(agentId, "status", abi.encode("active"));
```

### Build Reputation

```solidity
// Client gives feedback (needs agent's signature)
reputationRegistry.giveFeedback(
    agentId,
    100, // Perfect score!
    bytes32("quality"),
    bytes32("helpful"),
    "ipfs://detailed-feedback",
    keccak256("feedback-content"),
    signature
);

// Check average score
(uint64 count, uint8 avgScore) = reputationRegistry.getSummary(
    agentId,
    new address[](0),
    bytes32(0),
    bytes32(0)
);
```

### Get Validated

```solidity
// Request validation from TEE provider
validationRegistry.validationRequest(
    teeValidatorAddress,
    agentId,
    "ipfs://code-and-config",
    keccak256("validation-request")
);

// TEE validator responds
validationRegistry.validationResponse(
    requestHash,
    95, // Validation score
    "ipfs://tee-attestation",
    keccak256("attestation-data"),
    bytes32("tee-verified")
);
```

## GitHub Reputation Provider

The `GitHubReputationProvider` contract bridges off-chain GitHub contribution data to on-chain reputation:

### Features
- **Oracle-signed attestations** of GitHub contribution scores
- **Stake discounts** based on contribution level (10-50%)
- **Agent identity linking** between GitHub and ERC-8004 agents
- **ValidationRegistry integration** for on-chain verification

### Stake Discount Tiers
| GitHub Score | Stake Discount |
|--------------|----------------|
| 30-50        | 10%            |
| 51-70        | 20%            |
| 71-90        | 35%            |
| 91-100       | 50%            |

### Integration Flow
1. User links GitHub account via leaderboard.jeju.network
2. User signs message to verify wallet ownership
3. Leaderboard oracle generates attestation with contribution score
4. User submits attestation on-chain via GitHubReputationProvider
5. Stake discounts apply to ModerationMarketplace and other contracts

### Example Usage
```solidity
// Submit attestation (user must own the agent)
provider.submitAttestation(
    agentId,
    score,        // 0-100 normalized score
    totalScore,   // Raw GitHub score
    mergedPrs,
    totalCommits,
    timestamp,
    oracleSignature
);

// Query stake discount for moderation
uint256 discountBps = provider.getStakeDiscount(userWallet);
// Returns 0-5000 (0-50% in basis points)

// Check if user has reputation boost
(bool hasBoost, uint8 score) = provider.hasReputationBoost(userWallet);
```

## Future Enhancements

- [x] GitHub reputation integration
- [ ] Agent search and filtering
- [ ] Reputation dashboard
- [ ] Validation marketplace
- [ ] Cross-chain agent identity
- [ ] Agent analytics and insights
- [ ] Automated reputation aggregation
- [ ] Integration with AI agent frameworks

## Resources

- ERC-8004 Specification: https://eips.ethereum.org/EIPS/eip-8004
- Jeju Documentation: https://docs.jeju.network/registry
- Web Viewer: `contracts/web/registry-viewer.html`
- Tests: `contracts/test/*Registry*.t.sol`

## Support & Contact

- Discord: https://discord.gg/jeju
- Security: security@jeju.network
- Docs: https://docs.jeju.network

