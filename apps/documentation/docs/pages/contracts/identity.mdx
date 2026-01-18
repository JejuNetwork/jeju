# Identity (ERC-8004)

On-chain identity system for applications and AI agents.

## IdentityRegistry

Central registry for agent identity following ERC-8004 standard.

**Location:** `src/registry/IdentityRegistry.sol`

### Features

- Register applications and agents with on-chain identity
- Store metadata: name, description, endpoints
- A2A and MCP endpoint discovery
- Trust labels and reputation scores
- Ban integration for moderation

### Interface

```solidity
interface IIdentityRegistry {
    struct AgentInfo {
        address owner;
        string name;
        string description;
        string a2aEndpoint;
        string mcpEndpoint;
        string metadataUri;
        uint256 registrationTime;
        bool active;
    }
    
    function register(
        string memory name,
        string memory description,
        string memory a2aEndpoint,
        string memory mcpEndpoint,
        string memory metadataUri
    ) external returns (uint256 agentId);
    
    function getAgent(uint256 agentId) external view returns (AgentInfo memory);
    function getAgentByAddress(address owner) external view returns (AgentInfo memory);
    function isRegistered(address owner) external view returns (bool);
    function updateEndpoints(string memory a2aEndpoint, string memory mcpEndpoint) external;
    function deactivate() external;
}
```

### Register an Agent

```typescript
import { IdentityRegistryAbi } from '@jejunetwork/contracts';
import { getContract } from '@jejunetwork/config';

const registry = getContract('registry', 'identity');

// Register
const tx = await client.writeContract({
  address: registry,
  abi: IdentityRegistryAbi,
  functionName: 'register',
  args: [
    'My Agent',                              // name
    'AI assistant for trading',              // description
    'https://myagent.com/a2a',              // A2A endpoint
    'https://myagent.com/mcp',              // MCP endpoint
    'ipfs://Qm...'                          // Metadata URI
  ],
});

// Query agent
const agent = await client.readContract({
  address: registry,
  abi: IdentityRegistryAbi,
  functionName: 'getAgentByAddress',
  args: [agentAddress],
});
```

### Agent Discovery

Other agents discover services via the registry:

```typescript
// Find all active agents
const agents = await indexer.query(`
  query {
    agents(where: { active: true }) {
      id
      name
      a2aEndpoint
      mcpEndpoint
    }
  }
`);

// Connect to agent's A2A endpoint
const response = await fetch(agent.a2aEndpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'task',
    task: { description: 'Analyze market data' }
  }),
});
```

## BanManager

Network-wide moderation system.

**Location:** `src/moderation/BanManager.sol`

### Features

- Ban addresses from network participation
- Integration with JejuToken (banned cannot transfer)
- Multiple ban sources (admin, moderation marketplace)
- Ban-exempt addresses for appeals

### Interface

```solidity
interface IBanManager {
    function ban(address user, string memory reason) external;
    function unban(address user) external;
    function isBanned(address user) external view returns (bool);
    function getBanInfo(address user) external view returns (
        bool banned,
        uint256 banTime,
        string memory reason,
        address bannedBy
    );
}
```

### How Bans Propagate

1. User banned via BanManager
2. JejuToken checks BanManager on transfers
3. Paymasters check BanManager before processing
4. Apps query BanManager before allowing actions

```typescript
// Check if user is banned
const isBanned = await client.readContract({
  address: banManager,
  abi: BanManagerAbi,
  functionName: 'isBanned',
  args: [userAddress],
});

if (isBanned) {
  // Reject transaction/action
}
```

## ModerationMarketplace

Futarchy-based decentralized moderation.

**Location:** `src/moderation/ModerationMarketplace.sol`

### Features

- Stake-based moderation proposals
- Prediction market for ban outcomes
- Decentralized decision making
- Slashing for wrong predictions

### Flow

1. Reporter stakes tokens to propose ban
2. Market opens for YES/NO predictions
3. After resolution period, outcome decided
4. Winners receive loser stakes
5. If YES wins, target is banned

See [Moderation](/contracts/moderation) for details.

## ReputationLabelManager

Assign and query reputation labels.

**Location:** `src/moderation/ReputationLabelManager.sol`

### Features

- Assign labels to addresses (verified, trusted, etc.)
- Query labels for access control
- Integration with external reputation providers

### Interface

```solidity
interface IReputationLabelManager {
    function addLabel(address user, string memory label) external;
    function removeLabel(address user, string memory label) external;
    function hasLabel(address user, string memory label) external view returns (bool);
    function getLabels(address user) external view returns (string[] memory);
}
```

## Deployment

```bash
cd packages/contracts

# Deploy identity system
forge script script/DeployIdentityRegistry.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Integration with Apps

Apps should:

1. Register themselves in IdentityRegistry
2. Check BanManager before processing user actions
3. Query agent endpoints for A2A communication
4. Respect reputation labels for access control

