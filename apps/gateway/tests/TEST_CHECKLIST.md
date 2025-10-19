# Gateway Portal - Pre-Deployment Test Checklist

## Before Running Tests

- [ ] Localnet is running on port 9545
- [ ] Gateway UI is running on port 4001
- [ ] A2A server is running on port 4003
- [ ] Contracts are deployed (addresses in `.env.local`)
- [ ] Chromium browser installed (`bunx playwright install chromium`)

## Unit Tests (Fast - Run First)

```bash
bun run test:unit
```

- [ ] Token equality tests pass
- [ ] Token utility functions work
- [ ] Token configuration is complete
- [ ] All 4 tokens present (elizaOS, CLANKER, VIRTUAL, CLANKERMON)

## Contract Tests (30s - Run Second)

```bash
bun run test:contracts
```

### TokenRegistry
- [ ] Can read registration fee
- [ ] Can get all registered tokens
- [ ] Can read token configs
- [ ] Fee margins are valid (min <= max <= 500)

### PaymasterFactory
- [ ] Can get all deployments
- [ ] Can read deployment details
- [ ] Deployments have all 3 contracts (paymaster, vault, distributor)
- [ ] All addresses are unique and non-zero

### LiquidityVault
- [ ] Can read LP positions
- [ ] Vault has correct token
- [ ] Can track ETH liquidity

### NodeStakingManager
- [ ] Can read network stats
- [ ] Can read operator stats
- [ ] Can get operator's nodes
- [ ] Can read node info
- [ ] Can calculate pending rewards
- [ ] Token distribution tracking works
- [ ] Max 5 nodes per operator enforced

### IdentityRegistry
- [ ] Can calculate required stake
- [ ] Can get all registered agents
- [ ] Can filter agents by tag
- [ ] Can read agent metadata
- [ ] Can read stake info
- [ ] Can verify ownership

## A2A Tests (10s - Run Third)

```bash
bun run test:a2a
```

### Agent Discovery
- [ ] Agent card served at `/.well-known/agent-card.json`
- [ ] All skills listed in card
- [ ] Capabilities metadata present
- [ ] Transport preferences specified

### JSON-RPC Communication
- [ ] `message/send` method works
- [ ] Unknown methods return error
- [ ] `list-protocol-tokens` skill executes
- [ ] `get-node-stats` skill executes
- [ ] `list-nodes` skill executes
- [ ] `list-registered-apps` skill executes
- [ ] `get-app-by-tag` skill executes
- [ ] Unknown skills return error
- [ ] Missing params handled gracefully

### Governance Agent
- [ ] Governance agent card accessible
- [ ] Futarchy capabilities listed
- [ ] Governance skills present
- [ ] Metadata includes voting mechanism

## E2E Tests (5min - Run Last)

```bash
bun run test:e2e:headed
```

### 1. Wallet Connection
- [ ] Connect prompt shows when disconnected
- [ ] MetaMask connection succeeds
- [ ] Token balances display after connect
- [ ] All navigation tabs appear
- [ ] Wallet address shows in header

### 2. Token Registry
- [ ] Registered tokens list displays
- [ ] Register form is accessible
- [ ] Token address validation works
- [ ] Fee range validation works
- [ ] Max 5% fee enforced
- [ ] Registration fee displayed
- [ ] Token details show in cards

### 3. Bridge Tokens
- [ ] Bridge interface displays
- [ ] elizaOS warning shown (native token)
- [ ] Only bridgeable tokens in selector
- [ ] Custom token mode works
- [ ] Amount validation works
- [ ] Optional recipient field works
- [ ] Bridge info displayed
- [ ] Custom address validation works

### 4. Deploy Paymaster
- [ ] Deployment interface displays
- [ ] Factory info shown
- [ ] ALL tokens included (including elizaOS)
- [ ] Unregistered token warning works
- [ ] Fee margin slider appears
- [ ] Cost estimate shown
- [ ] Already deployed warning works
- [ ] Fee percentage updates

### 5. Liquidity Provision
- [ ] Add liquidity interface displays
- [ ] Info box explains process
- [ ] All tokens in selector
- [ ] No paymaster warning works
- [ ] ETH amount validation works
- [ ] LP position displays if exists
- [ ] Fee earnings shown
- [ ] LP dashboard accessible
- [ ] Claim button appears for fees

### 6. Node Staking
- [ ] Node staking interface displays
- [ ] Network overview accessible
- [ ] My nodes section works
- [ ] Register form accessible
- [ ] All tokens available for staking
- [ ] All tokens available for rewards
- [ ] Minimum stake validation ($1000)
- [ ] USD calculation works
- [ ] RPC URL field present
- [ ] Region selector works
- [ ] Underserved region bonus shown
- [ ] Requirements displayed
- [ ] Reward estimation works
- [ ] Max 5 nodes enforced
- [ ] Node cards show details
- [ ] Claim/deregister buttons work

### 7. App Registry
- [ ] Registry interface displays
- [ ] Browse and register tabs work
- [ ] Apps list displays
- [ ] Tag filtering works
- [ ] App cards show metadata
- [ ] A2A badge shows for apps with endpoints
- [ ] App detail modal opens
- [ ] Registration form validates
- [ ] All tag categories available
- [ ] Multiple tag selection works
- [ ] Stake token selector works
- [ ] Required stake calculated
- [ ] Refundable stake info shown

### 8. Multi-Token Equality
- [ ] All 4 tokens in balance view
- [ ] elizaOS shown first
- [ ] Equal UI treatment in selectors
- [ ] USD values consistent
- [ ] All available for paymasters
- [ ] All available for liquidity
- [ ] All available for node staking
- [ ] All available for app stakes
- [ ] elizaOS excluded from bridge
- [ ] Logos displayed
- [ ] Prices shown consistently

## Integration Tests

```bash
bun run test:integration
```

- [ ] Complete token lifecycle
- [ ] Bridge → deploy → liquidity → earnings
- [ ] Node staking complete flow
- [ ] App registry complete flow

## Final Verification

### Visual Inspection
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] All images load correctly
- [ ] Animations smooth
- [ ] Responsive on mobile

### Performance
- [ ] Page load < 2s
- [ ] Token balance load < 1s
- [ ] Contract reads < 500ms
- [ ] No memory leaks

### Accessibility
- [ ] All buttons have labels
- [ ] Forms have proper labels
- [ ] Error messages are clear
- [ ] Success feedback visible

## Sign-Off

- [ ] All unit tests passing
- [ ] All contract tests passing
- [ ] All A2A tests passing
- [ ] All E2E tests passing
- [ ] All integration tests passing
- [ ] No critical bugs found
- [ ] Performance acceptable
- [ ] Ready for deployment

**Tested by:** _________________

**Date:** _________________

**Notes:**
_______________________________________________
_______________________________________________
_______________________________________________

