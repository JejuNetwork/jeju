# Moderation Contracts

Futarchy-based content moderation and ban management.

## Overview

Jeju uses a decentralized moderation system. **BanManager** executes bans across the network. **ModerationMarketplace** provides stake-based prediction markets for ban decisions. **ReportingSystem** handles submission and tracking of moderation reports.

## BanManager

Network-wide ban enforcement.

**Location:** `src/moderation/BanManager.sol`

Bans addresses from protocol participation with multiple ban sources (admin, marketplace), ban-exempt addresses for appeals, and integration with JejuToken.

When a ban is executed, JejuToken blocks transfers, paymasters reject transactions, apps block actions, and agent identity is deactivated.

```typescript
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

Futarchy prediction market for moderation decisions.

**Location:** `src/moderation/ModerationMarketplace.sol`

Anyone can propose bans by staking. A prediction market opens for YES/NO outcomes with time-weighted voting. Stakes are redistributed to winners.

### Proposal Flow

1. **Create**: Reporter stakes tokens to propose ban
2. **Market**: Others stake YES or NO
3. **Resolution**: After deadline, outcome is determined
4. **Settlement**: Winners receive loser stakes
5. **Execution**: If YES wins, target is banned

```typescript
// Propose ban (requires stake)
const tx = await client.writeContract({
  address: moderationMarketplace,
  abi: ModerationMarketplaceAbi,
  functionName: 'createProposal',
  args: [targetAddress, 'Spam behavior in protocol'],
  value: parseEther('0.1'),
});

// Stake on outcome
await client.writeContract({
  address: moderationMarketplace,
  abi: ModerationMarketplaceAbi,
  functionName: 'stake',
  args: [proposalId, true], // true = support ban
  value: parseEther('0.05'),
});
```

## ReportingSystem

Submit and track moderation reports.

**Location:** `src/moderation/ReportingSystem.sol`

Submit reports with evidence, track report status, escalate to marketplace, and build reporter reputation. Report statuses include Pending, Reviewing, Escalated, Resolved, and Rejected.

## ReputationLabelManager

Assign trust labels to addresses.

**Location:** `src/moderation/ReputationLabelManager.sol`

Common labels include "verified" for verified identity, "trusted" for high reputation, "flagged" for under review, and "guardian" for moderation privileges.

## Deployment

```bash
cd packages/contracts

forge script script/DeployModeration.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Integration

Apps should check `BanManager.isBanned()` before processing actions, display ban status in UIs, allow reporting via ReportingSystem, and respect reputation labels for access control.
