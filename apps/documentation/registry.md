# Agent Registry System (ERC-8004)

Jeju Network implements the [ERC-8004 Trustless Agent Registry](https://eips.ethereum.org/EIPS/eip-8004) standard, providing decentralized infrastructure for AI agents to establish identity, build reputation, and get validated.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Contracts](#core-contracts)
4. [Quick Start](#quick-start)
5. [Integration Guide](#integration-guide)
6. [Web Viewer](#web-viewer)
7. [API Reference](#api-reference)
8. [Security](#security)

## Overview

The ERC-8004 registry system enables:

- **Agent Identity**: Register agents as ERC-721 NFTs with metadata
- **Reputation**: Track feedback and ratings from users
- **Validation**: Request and record independent verification
- **Discovery**: Browse and search registered agents
- **Monetization**: Integrate with Jeju's paymaster for revenue

### Why ERC-8004?

- **Standardized**: Interoperable across platforms and tools
- **Decentralized**: No central authority controls agent data
- **Composable**: Build on top with DeFi, NFT, and AI tooling
- **Trustless**: Cryptographic proofs for all interactions
- **NFT-Based**: Agents are tradeable, transferable assets

## Architecture

```
┌─────────────────────────────────────────┐
│         Jeju Ecosystem                   │
├─────────────────────────────────────────┤
│                                          │
│  ┌─────────────────┐  ┌──────────────┐ │
│  │ Paymaster       │  │  Registry    │ │
│  │ System          │  │  System      │ │
│  │                 │  │              │ │
│  │ - Token         │  │ - Identity   │ │
│  │ - Vault         │  │ - Reputation │ │
│  │ - Distributor   │  │ - Validation │ │
│  │ - Paymaster     │  │              │ │
│  │ - Oracle        │  │              │ │
│  └────────┬────────┘  └──────┬───────┘ │
│           │                  │          │
│           └──────────────────┘          │
│              Integrated System          │
│                                          │
│  Agent Revenue + Identity + Reputation  │
└─────────────────────────────────────────┘
```

### System Components

1. **IdentityRegistry**: ERC-721 contract storing agent identities
2. **ReputationRegistry**: Feedback and rating system
3. **ValidationRegistry**: Independent verification system
4. **Web Viewer**: Frontend for browsing agents
5. **Paymaster Integration**: Revenue earning for agents

## Core Contracts

### 1. IdentityRegistry

**Location**: `contracts/src/registry/IdentityRegistry.sol`

**Purpose**: Register and manage agent identities as NFTs

**Interface**:
```solidity
interface IIdentityRegistry {
    // Register agent
    function register(string calldata tokenURI) external returns (uint256 agentId);
    function register(string calldata tokenURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
    function register() external returns (uint256 agentId);
    
    // Metadata
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;
    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory);
    
    // Views
    function totalAgents() external view returns (uint256);
    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
}
```

### 2. ReputationRegistry

**Location**: `contracts/src/registry/ReputationRegistry.sol`

**Purpose**: Track feedback and reputation for agents

**Interface**:
```solidity
interface IReputationRegistry {
    // Give feedback
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash,
        bytes memory feedbackAuth
    ) external;
    
    // Manage feedback
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
    function appendResponse(...) external;
    
    // Query
    function getSummary(uint256 agentId, ...) external view returns (uint64 count, uint8 avgScore);
    function readFeedback(...) external view returns (...);
}
```

### 3. ValidationRegistry

**Location**: `contracts/src/registry/ValidationRegistry.sol`

**Purpose**: Request and record independent validations

**Interface**:
```solidity
interface IValidationRegistry {
    // Request validation
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external;
    
    // Provide validation
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external;
    
    // Query
    function getValidationStatus(bytes32 requestHash) external view returns (...);
    function getSummary(uint256 agentId, ...) external view returns (uint64 count, uint8 avgResponse);
}
```

## Quick Start

### Deploy Registry (Included in Main Deployment)

```bash
# Deploy complete system (paymaster + registry)
cd contracts
forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url http://localhost:8545 \
  --broadcast

# Output includes:
# - Identity Registry: 0x...
# - Reputation Registry: 0x...
# - Validation Registry: 0x...
```

### Register Your First Agent

```bash
# Using cast
cast send $IDENTITY_REGISTRY \
  "register(string)" "ipfs://QmYourAgentConfig" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Or in Solidity
uint256 agentId = identityRegistry.register("ipfs://QmYourAgentConfig");
```

### Set Agent Metadata

```bash
# Set name
cast send $IDENTITY_REGISTRY \
  "setMetadata(uint256,string,bytes)" \
  1 \
  "name" \
  $(cast abi-encode "x(string)" "My AI Agent") \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# In Solidity
identityRegistry.setMetadata(
    agentId,
    "name",
    abi.encode("My AI Agent")
);
```

### View Registry

```bash
# Start web viewer
cd contracts/web
python3 -m http.server 3000

# Open browser
open http://localhost:3000/registry-viewer.html
```

## Integration Guide

### Agent Revenue Integration

Combine registry with paymaster to earn fees:

```solidity
// 1. Register your agent
uint256 agentId = identityRegistry.register("ipfs://my-agent-config");

// 2. Set revenue wallet in metadata
address revenueWallet = 0xYourWallet;
identityRegistry.setMetadata(
    agentId,
    "revenueWallet",
    abi.encode(revenueWallet)
);

// 3. Deploy your app contract
SimpleGame game = new SimpleGame(revenueWallet);

// 4. Users interact via paymaster
// Users include your revenueWallet in paymasterAndData
// You automatically earn 50% of transaction fees!

// 5. Claim earnings
feeDistributor.claimEarnings(); // Sends to revenueWallet
```

### Building Reputation

```solidity
// After successful interactions, clients give feedback

// Client gets signature from agent
bytes memory signature = getAgentSignature(
    agentId,
    clientAddress,
    indexLimit,
    expiry
);

// Client submits feedback
reputationRegistry.giveFeedback(
    agentId,
    95, // Excellent service!
    bytes32("quality"),
    bytes32("fast"),
    "ipfs://detailed-review",
    keccak256("review-content"),
    signature
);

// Query reputation
(uint64 count, uint8 avgScore) = reputationRegistry.getSummary(
    agentId,
    new address[](0), // All clients
    bytes32(0),       // All tags
    bytes32(0)
);
// avgScore = 95 (0-100 scale)
```

### Getting Validated

```solidity
// Request validation from TEE provider
validationRegistry.validationRequest(
    teeProvider,
    agentId,
    "ipfs://code-and-config",
    keccak256("validation-data")
);

// TEE provider validates and responds
validationRegistry.validationResponse(
    requestHash,
    100, // Fully validated
    "ipfs://tee-attestation",
    keccak256("attestation"),
    bytes32("tee-verified")
);

// Display validation badge
(, , uint8 validationScore, , ) = validationRegistry.getValidationStatus(requestHash);
// validationScore = 100 → Show "TEE Verified ✓" badge
```

## Web Viewer

The registry includes a web-based viewer for browsing registered agents.

### Starting the Viewer

```bash
cd contracts/web
python3 -m http.server 3000
# Open http://localhost:3000/registry-viewer.html
```

### Features

- 🌐 Multi-network support (Localnet, Testnet, Mainnet)
- 📊 Real-time agent statistics
- 🔍 Browse all registered agents
- 📝 View metadata and details
- 💼 MetaMask integration
- ⚡ Auto-refresh capability

### Screenshot

```
┌────────────────────────────────────────┐
│    🤖 Jeju Agent Registry              │
│    ERC-8004 Trustless Agent Registry   │
└────────────────────────────────────────┘

┌─────────┬─────────┬─────────┐
│Localnet │ Testnet │ Mainnet │
└─────────┴─────────┴─────────┘

        [Connect Wallet]

┌────────────────────────────────────────┐
│ Agent #1                                │
│ Owner: 0xf39F...2266                    │
│ 📄 ipfs://QmAgent123                    │
│                                         │
│ Metadata                                │
│ name: Trading Bot                       │
│ type: defi                              │
│ model: GPT-4                            │
└────────────────────────────────────────┘
```

## API Reference

### IdentityRegistry

#### Register Agent

```solidity
// Simple registration
function register() external returns (uint256 agentId);

// With token URI
function register(string calldata tokenURI) external returns (uint256 agentId);

// With token URI and metadata
function register(
    string calldata tokenURI,
    MetadataEntry[] calldata metadata
) external returns (uint256 agentId);
```

#### Metadata Management

```solidity
// Set metadata
function setMetadata(
    uint256 agentId,
    string calldata key,
    bytes calldata value
) external;

// Get metadata
function getMetadata(
    uint256 agentId,
    string calldata key
) external view returns (bytes memory value);
```

#### Queries

```solidity
function totalAgents() external view returns (uint256);
function agentExists(uint256 agentId) external view returns (bool);
function ownerOf(uint256 agentId) external view returns (address);
function tokenURI(uint256 agentId) external view returns (string memory);
function version() external pure returns (string memory);
```

### ReputationRegistry

#### Give Feedback

```solidity
function giveFeedback(
    uint256 agentId,
    uint8 score,        // 0-100
    bytes32 tag1,       // e.g., bytes32("quality")
    bytes32 tag2,       // e.g., bytes32("fast")
    string calldata fileuri,    // IPFS link
    bytes32 filehash,   // KECCAK-256 hash
    bytes memory feedbackAuth   // Signature from agent
) external;
```

#### Manage Feedback

```solidity
function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

function appendResponse(
    uint256 agentId,
    address clientAddress,
    uint64 feedbackIndex,
    string calldata responseUri,
    bytes32 responseHash
) external;
```

#### Query Reputation

```solidity
function getSummary(
    uint256 agentId,
    address[] calldata clientAddresses,
    bytes32 tag1,
    bytes32 tag2
) external view returns (uint64 count, uint8 averageScore);

function readFeedback(
    uint256 agentId,
    address clientAddress,
    uint64 index
) external view returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked);
```

### ValidationRegistry

#### Request Validation

```solidity
function validationRequest(
    address validatorAddress,
    uint256 agentId,
    string calldata requestUri,
    bytes32 requestHash
) external;
```

#### Provide Validation

```solidity
function validationResponse(
    bytes32 requestHash,
    uint8 response,     // 0-100 validation score
    string calldata responseUri,
    bytes32 responseHash,
    bytes32 tag        // e.g., bytes32("verified")
) external;
```

#### Query Validations

```solidity
function getValidationStatus(bytes32 requestHash) external view returns (
    address validatorAddress,
    uint256 agentId,
    uint8 response,
    bytes32 tag,
    uint256 lastUpdate
);

function getSummary(
    uint256 agentId,
    address[] calldata validatorAddresses,
    bytes32 tag
) external view returns (uint64 count, uint8 avgResponse);
```

## Security

### Agent Identity
- ✅ NFT-based ownership (ERC-721)
- ✅ Transferable and tradeable
- ✅ Metadata is public and immutable
- ⚠️ Consider implications of transferring agents

### Reputation System
- ✅ Cryptographic authorization required
- ✅ Supports both EOA (EIP-191) and smart contracts (ERC-1271)
- ✅ Feedback can be revoked by client
- ✅ Responses are public and permissionless
- ⚠️ No built-in Sybil protection (implement at app layer)

### Validation System
- ✅ Only agent owner can request validation
- ✅ Only designated validator can respond
- ✅ Progressive validation supported
- ✅ All data is public and verifiable
- ⚠️ Validator reputation not built-in (use external sources)

### Best Practices

1. **Agent Registration**:
   - Use IPFS for tokenURI (decentralized, immutable)
   - Include comprehensive metadata
   - Set revenue wallet for monetization

2. **Reputation Management**:
   - Implement signature verification on client side
   - Use appropriate tags for categorization
   - Monitor for spam/abuse

3. **Validation Requests**:
   - Choose reputable validators
   - Provide sufficient context in request
   - Verify validator signatures

4. **Metadata Storage**:
   - Store critical data on-chain
   - Use IPFS for large content
   - Consider metadata immutability

## Gas Costs

Approximate gas usage on Jeju Network:

| Operation | Gas Cost |
|-----------|----------|
| Register Agent | ~75,000 |
| Register w/ Metadata | ~300,000 |
| Set Metadata | ~50,000 |
| Give Feedback | ~150,000 |
| Request Validation | ~120,000 |
| Validation Response | ~80,000 |

Gas prices on Jeju are extremely low due to L3 architecture. Actual costs will vary based on network congestion and operation complexity.

## Testing

### Run All Registry Tests

```bash
cd contracts
forge test --match-path "test/*Registry*.t.sol" -vv
```

### Test Coverage

- ✅ 18 tests for IdentityRegistry
- ✅ 7 integration tests
- ✅ Access control tests
- ✅ Metadata management tests
- ✅ NFT transfer tests
- ✅ Multi-agent scenarios

## Deployment

### Included in Main Deployment

The registry is automatically deployed with the liquidity system:

```bash
forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

Deploys:
- ✅ IdentityRegistry
- ✅ ReputationRegistry
- ✅ ValidationRegistry
- ✅ All paymaster contracts

### Standalone Deployment

Deploy only registry contracts:

```bash
cd contracts
forge create src/registry/IdentityRegistry.sol:IdentityRegistry \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Then deploy dependent contracts with IdentityRegistry address
```

## Examples

### Full Agent Lifecycle

```solidity
// 1. Register agent
uint256 agentId = identityRegistry.register("ipfs://agent-config");

// 2. Set metadata
identityRegistry.setMetadata(agentId, "name", abi.encode("DeFi Agent"));
identityRegistry.setMetadata(agentId, "type", abi.encode("trading"));
identityRegistry.setMetadata(agentId, "revenueWallet", abi.encode(myWallet));

// 3. Deploy app contract
SimpleGame game = new SimpleGame(myWallet);

// 4. Users interact and you earn fees automatically

// 5. Build reputation
// Clients give feedback after successful interactions

// 6. Get validated
validationRegistry.validationRequest(teeValidator, agentId, "ipfs://code", hash);

// 7. Claim earnings
feeDistributor.claimEarnings();
```

### Create Agent Marketplace

```solidity
// Agents are ERC-721 NFTs, so they're tradeable!

// List agent for sale on OpenSea/Blur/etc
IERC721(identityRegistry).setApprovalForAll(marketplace, true);

// Or create custom marketplace
contract AgentMarketplace {
    IdentityRegistry public registry;
    
    struct Listing {
        uint256 agentId;
        uint256 price;
        address seller;
    }
    
    mapping(uint256 => Listing) public listings;
    
    function listAgent(uint256 agentId, uint256 price) external {
        require(registry.ownerOf(agentId) == msg.sender, "Not owner");
        listings[agentId] = Listing(agentId, price, msg.sender);
    }
    
    function buyAgent(uint256 agentId) external payable {
        Listing memory listing = listings[agentId];
        require(msg.value >= listing.price, "Insufficient payment");
        
        registry.transferFrom(listing.seller, msg.sender, agentId);
        payable(listing.seller).transfer(msg.value);
        
        delete listings[agentId];
    }
}
```

## Roadmap

### Current (v1.0.0)
- ✅ ERC-8004 v1.0 compliance
- ✅ Identity, Reputation, Validation registries
- ✅ Web viewer
- ✅ Paymaster integration
- ✅ Solidity 0.8.28 support

### Future Enhancements
- [ ] Advanced search and filtering
- [ ] Reputation analytics dashboard
- [ ] Validator marketplace
- [ ] Cross-chain identity bridges
- [ ] Agent performance metrics
- [ ] Automated reputation aggregation
- [ ] Integration with agent frameworks (eliza, langchain, etc.)

## Resources

- **ERC-8004 Spec**: https://eips.ethereum.org/EIPS/eip-8004
- **Contract Source**: `contracts/src/registry/`
- **Tests**: `contracts/test/*Registry*.t.sol`
- **Web Viewer**: `contracts/web/registry-viewer.html`
- **Documentation**: `contracts/src/registry/README.md`

## Support

- 📚 **Docs**: https://docs.jeju.network/registry
- 💬 **Discord**: https://discord.gg/jeju
- 🐛 **Issues**: https://github.com/elizaos/jeju/issues
- 🔒 **Security**: security@jeju.network

## License

- ERC-8004 Standard: CC0-1.0
- Jeju Implementation: MIT

