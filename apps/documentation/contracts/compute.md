# Compute Contracts

Smart contracts for the decentralized compute marketplace.

## Overview

The compute system enables:
- Provider registration with hardware attestation
- Compute rental sessions with escrow
- Inference serving with per-request billing
- Stake-based accountability

## ComputeRegistry

Registration for compute providers (ERC-8004 extension).

**Location:** `src/compute/ComputeRegistry.sol`

### Features

- Provider registration with hardware specs
- TEE attestation verification
- Capability discovery (GPU, TEE type)
- Pricing configuration

### Interface

```solidity
interface IComputeRegistry {
    struct Provider {
        address owner;
        string endpoint;
        string hardwareAttestation;
        uint256 gpuCount;
        string gpuModel;
        uint256 pricePerHour;
        bool active;
    }
    
    function register(
        string memory endpoint,
        string memory hardwareAttestation,
        uint256 pricePerHour
    ) external payable returns (uint256 providerId);
    
    function updatePricing(uint256 pricePerHour) external;
    function setActive(bool active) external;
    function getProvider(uint256 providerId) external view returns (Provider memory);
    function getProviderByAddress(address owner) external view returns (Provider memory);
}
```

### Registering a Provider

```typescript
import { ComputeRegistryAbi } from '@jejunetwork/contracts';

const tx = await client.writeContract({
  address: computeRegistry,
  abi: ComputeRegistryAbi,
  functionName: 'register',
  args: [
    'https://mynode.example.com:4007',  // API endpoint
    attestationData,                     // Hardware attestation
    parseEther('0.01'),                  // Price per hour in ETH
  ],
  value: parseEther('0.1'),  // Stake
});
```

## ComputeRental

Session management for compute rentals.

**Location:** `src/compute/ComputeRental.sol`

### Features

- Create rental sessions with escrow
- SSH key storage for access
- Session extension and termination
- Automatic refunds on early termination

### Interface

```solidity
interface IComputeRental {
    struct Session {
        address renter;
        uint256 providerId;
        uint256 startTime;
        uint256 endTime;
        uint256 deposit;
        string sshPublicKey;
        bool active;
    }
    
    function createSession(
        uint256 providerId,
        uint256 durationHours,
        string memory sshPublicKey
    ) external payable returns (uint256 sessionId);
    
    function extendSession(uint256 sessionId, uint256 additionalHours) external payable;
    function terminateSession(uint256 sessionId) external;
    function getSession(uint256 sessionId) external view returns (Session memory);
}
```

### Creating a Rental

```typescript
// Rent compute for 24 hours
const tx = await client.writeContract({
  address: computeRental,
  abi: ComputeRentalAbi,
  functionName: 'createSession',
  args: [
    providerId,
    24n,                               // Duration in hours
    'ssh-rsa AAAA... user@host',       // SSH public key
  ],
  value: parseEther('0.24'),  // 24 hours × 0.01 ETH/hour
});
```

## InferenceServing

Per-request billing for AI inference.

**Location:** `src/compute/InferenceServing.sol`

### Features

- Pre-paid inference credits
- Per-token billing
- Usage tracking
- Settlement between users and providers

### Interface

```solidity
interface IInferenceServing {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    
    function recordUsage(
        address user,
        uint256 inputTokens,
        uint256 outputTokens,
        string memory model
    ) external;
    
    function getBalance(address user) external view returns (uint256);
    function getUsage(address user) external view returns (uint256 totalTokens, uint256 totalCost);
}
```

## LedgerManager

User balance management for compute services.

**Location:** `src/compute/LedgerManager.sol`

### Features

- Deposit/withdraw funds
- Track spending across services
- Automatic top-up (optional)

### Interface

```solidity
interface ILedgerManager {
    function deposit() external payable;
    function depositToken(address token, uint256 amount) external;
    function withdraw(uint256 amount) external;
    function withdrawToken(address token, uint256 amount) external;
    
    function getBalance(address user) external view returns (uint256 ethBalance);
    function getTokenBalance(address user, address token) external view returns (uint256);
}
```

## ComputeStaking

Stake management for providers and users.

**Location:** `src/compute/ComputeStaking.sol`

### Features

- Provider stake requirements
- User anti-spam stakes
- Slashing for misbehavior

### Stake Requirements

Providers require a minimum stake of 0.1 ETH as a quality guarantee. Users need 0.01 ETH minimum for spam prevention. Guardians must stake at least 1.0 ETH for moderation privileges.

## TriggerRegistry

Event-based execution triggers for agents.

**Location:** `src/compute/TriggerRegistry.sol`

### Features

- Cron-style scheduled execution
- Webhook triggers
- On-chain event triggers
- Gas sponsorship for triggers

### Interface

```solidity
interface ITriggerRegistry {
    enum TriggerType { Cron, Webhook, Event }
    
    struct Trigger {
        address agent;
        TriggerType triggerType;
        bytes config;
        bool active;
    }
    
    function createTrigger(
        TriggerType triggerType,
        bytes memory config
    ) external returns (uint256 triggerId);
    
    function executeTrigger(uint256 triggerId, bytes memory input) external;
    function deactivateTrigger(uint256 triggerId) external;
}
```

## Deployment

```bash
cd packages/contracts

# Deploy compute system
forge script script/DeployCompute.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Integration

See [Run a Compute Node Guide](/guides/run-compute-node) for provider setup.
See [Compute App](/applications/compute) for the full marketplace.

