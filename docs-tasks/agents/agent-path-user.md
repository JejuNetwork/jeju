# Agent Task: End User Path Documentation

## Scope
Create documentation for end users of Jeju applications.

## Target Audience
- Non-technical users
- Want to use Gateway, Bazaar, Wallet
- Bridge assets, swap tokens, stake
- Use DeFi features

## User Journey
1. Set up wallet
2. Get testnet tokens / bridge assets
3. Use Gateway (bridge, stake)
4. Use Bazaar (swap, NFTs)
5. Explore other apps

## Output Files

### 1. `apps/documentation/guides/user-guide.md`

```markdown
# User Guide

Get started using Jeju applications.

## Set Up Your Wallet

### Option 1: MetaMask
1. Install [MetaMask](https://metamask.io)
2. Click "Add Network" and enter:
   - Network Name: Jeju
   - RPC URL: https://rpc.jejunetwork.org
   - Chain ID: 420691
   - Currency: ETH

### Option 2: Jeju Wallet
[Jeju wallet setup]

## Get Tokens

### Testnet Faucet
Visit https://faucet.jejunetwork.org for free testnet ETH.

### Bridge from Ethereum
1. Go to https://gateway.jejunetwork.org
2. Connect wallet
3. Select amount to bridge
4. Confirm transaction

## Use Gateway

### Bridge Assets
[Step-by-step bridging]

### Stake JEJU
[Staking guide]

## Use Bazaar

### Swap Tokens
1. Go to https://bazaar.jejunetwork.org
2. Connect wallet
3. Select tokens to swap
4. Enter amount
5. Click "Swap"

### Provide Liquidity
[LP guide]

### Buy/Sell NFTs
[NFT marketplace guide]

## Gasless Transactions

Jeju supports gasless transactions—you can pay gas fees in USDC or JEJU instead of ETH.

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/guides/wallet-setup.md`

```markdown
# Wallet Setup

Connect your wallet to Jeju.

## Supported Wallets

- MetaMask
- Rabby
- Rainbow
- Coinbase Wallet
- WalletConnect

## Network Configuration

| Property | Value |
|----------|-------|
| Network Name | Jeju |
| RPC URL | https://rpc.jejunetwork.org |
| Chain ID | 420691 |
| Currency Symbol | ETH |
| Explorer | https://explorer.jejunetwork.org |

## Add Network Automatically

Visit any Jeju app and click "Add Network" when prompted.

## Testnet

For testing, add Jeju Testnet:
- RPC: https://testnet-rpc.jejunetwork.org
- Chain ID: 420690

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/path-user.md`

