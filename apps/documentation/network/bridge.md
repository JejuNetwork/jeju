# Bridge Assets

Learn how to bridge assets between Ethereum, Base, and Jeju.

## Official Bridge

**Testnet**: https://testnet-bridge.jeju.network  
**Mainnet**: https://bridge.jeju.network

::: warning Only Use Official Bridge
Always verify the URL. Scam sites may try to steal your funds. Bookmark the official bridge.
:::

## Bridging Architecture

```
Ethereum L1
    ↕️
  Base
    ↕️
 Jeju  ← You are here
```

To move assets to Jeju, you bridge through Base (Jeju's settlement layer).

## Quick Start Guide

### Testnet (Free)

1. **Get Sepolia ETH**: [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
2. **Bridge Sepolia → Base Sepolia**: [Superbridge](https://superbridge.app)
3. **Bridge Base Sepolia → Jeju Testnet**: [Jeju Bridge](https://testnet-bridge.jeju.network)

### Mainnet

1. **Get ETH on Base**: Bridge from Ethereum via [Superbridge](https://superbridge.app)
2. **Bridge Base → Jeju**: [Jeju Bridge](https://bridge.jeju.network)

## Step-by-Step: Base → Jeju

### Deposit (Base → Jeju)

Fast and cheap: **~2 minutes, minimal gas**

1. Visit https://bridge.jeju.network
2. Connect wallet (ensure you're on Base network)
3. Enter amount to bridge
4. Click "Bridge to Jeju"
5. Confirm transaction in wallet
6. Wait ~2 minutes for confirmation
7. Funds appear in your wallet on Jeju

**Details**:
- Time: ~2 minutes
- No bridge fees (pay only gas)
- Very low gas costs

### Withdrawal (Jeju → Base)

Slower due to fraud proof window: **7-14 days**

#### Standard Withdrawal (7 days)

1. Visit https://bridge.jeju.network
2. Connect wallet (ensure you're on Jeju network)
3. Enter amount to withdraw
4. Click "Bridge to Base"
5. Confirm transaction
6. **Wait 7 days** (challenge period)
7. Return to bridge
8. Click "Finalize Withdrawal"
9. Confirm transaction on Base
10. Funds released to your wallet

**Details**:
- Time: 7 days (challenge period)
- Very low gas costs on both networks

#### Fast Withdrawal (15 minutes)

Use third-party bridges for instant liquidity:

**Hop Protocol** (Recommended):
- Visit [hop.exchange](https://hop.exchange)
- Select Jeju → Base
- Small fee for instant liquidity
- Time: ~15 minutes

**Across Protocol**:
- Visit [across.to](https://across.to)
- Select Jeju → Base
- Small fee for instant liquidity
- Time: ~10 minutes

::: tip When to Use Fast Bridge
- Need funds quickly
- Small amounts
- Willing to pay small fee for speed

Use standard bridge for:
- Large amounts
- No rush
- No fees beyond gas
:::

## Supported Assets

### Native Assets

**ETH**: Fully supported (no wrapping needed)

```typescript
// ETH is the native gas token on all three chains
Ethereum: ETH
Base: ETH
Jeju: ETH
```

### Bridged Tokens

These tokens can be bridged Base → Jeju:

| Token | Base Address | Jeju Address |
|-------|--------------|--------------|
| **USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x...` |
| **USDT** | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | `0x...` |
| **DAI** | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | `0x...` |
| **WETH** | `0x4200000000000000000000000000000000000006` | `0x4200000000000000000000000000000000000006` |

::: info Adding Tokens
New tokens can be bridged permissionlessly. Deploy a bridged token on Jeju and anyone can bridge.
:::

### Bridge Your Own Token

1. Deploy token on Jeju
2. Register with Standard Bridge using `OptimismMintableERC20Factory`
3. Configure bridge mappings
4. Start bridging

For custom token bridging, refer to the OP Stack bridging documentation and our developer guides.

## How Bridging Works

### Technical Details

#### Deposits (Base → Jeju)

```
1. User calls L1StandardBridge.depositETH() on Base
2. ETH locked in bridge contract
3. Message sent to L2CrossDomainMessenger
4. After ~2 minutes, message relayed to Jeju
5. L2StandardBridge mints equivalent ETH on Jeju
6. ETH credited to user's address on Jeju
```

#### Withdrawals (Jeju → Base)

```
1. User calls L2StandardBridge.withdraw() on Jeju
2. ETH burned on Jeju
3. Withdrawal proof posted to Base after 7 days
4. User proves withdrawal on Base
5. L1StandardBridge releases ETH on Base
```

### Security

- **Fraud Proofs**: 7-day window to challenge invalid withdrawals
- **Fault Proof**: Anyone can dispute incorrect state transitions
- **No Central Authority**: Bridge is smart contract-based
- **Same Security as Base**: Jeju inherits Base's security model

## Bridge Contract Addresses

### Mainnet

**On Base (L1):**
<ContractAddresses network="mainnet" layer="l1" />

**On Jeju (L3):**
<ContractAddresses network="mainnet" layer="l2" />

### Testnet

**On Base Sepolia (L1):**
<ContractAddresses network="testnet" layer="l1" />

**On Jeju Testnet (L3):**
<ContractAddresses network="testnet" layer="l2" />

## Programmatic Bridging

### Using OP-SDK

```typescript
import { CrossChainMessenger, ETHBridgeAdapter } from '@eth-optimism/sdk';
import { ethers } from 'ethers';

// Setup providers
const baseProvider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const jejuProvider = new ethers.JsonRpcProvider('https://rpc.jeju.network');

// Create messenger
const messenger = new CrossChainMessenger({
  l1ChainId: 8453, // Base
  l2ChainId: 420691, // Jeju
  l1SignerOrProvider: baseSigner,
  l2SignerOrProvider: jejuSigner,
  bedrock: true,
});

// Deposit ETH
const deposit = await messenger.depositETH(
  ethers.parseEther('0.1') // 0.1 ETH
);
await deposit.wait();

// Wait for deposit to be relayed
await messenger.waitForMessageStatus(
  deposit.hash,
  MessageStatus.RELAYED
);

console.log('Deposit complete!');
```

### Withdraw ETH

```typescript
// Initiate withdrawal
const withdraw = await messenger.withdrawETH(
  ethers.parseEther('0.1')
);
await withdraw.wait();

// Wait 7 days...
await messenger.waitForMessageStatus(
  withdraw.hash,
  MessageStatus.READY_TO_PROVE
);

// Prove withdrawal
const prove = await messenger.proveMessage(withdraw.hash);
await prove.wait();

// Wait for challenge period...
await messenger.waitForMessageStatus(
  withdraw.hash,
  MessageStatus.READY_FOR_RELAY
);

// Finalize
const finalize = await messenger.finalizeMessage(withdraw.hash);
await finalize.wait();

console.log('Withdrawal complete!');
```

## Bridge UI Features

### Official Bridge Interface

**Features**:
- ✅ ETH bridging
- ✅ ERC-20 token bridging
- ✅ Transaction history
- ✅ Pending withdrawals tracker
- ✅ Gas estimation
- ✅ Automatic network switching
- ✅ Mobile responsive

**Coming Soon**:
- 🚧 NFT bridging (ERC-721)
- 🚧 Batch bridging
- 🚧 Price charts
- 🚧 Bridge analytics

## FAQ

### How long do deposits take?

**Base → Jeju**: ~2 minutes

The time it takes for Base to produce a block and Jeju to derive it.

### How long do withdrawals take?

**Standard**: 7 days (fraud proof window)  
**Fast Bridge**: 15 minutes (small fee)

### Are there fees?

**Standard Bridge**: No bridge fees (only gas)  
**Fast Bridge**: Small fee for instant liquidity
Gas costs are very low on both Base and Jeju.

### What if I send to wrong address?

**Transactions are irreversible**. Always:
- Double-check recipient address
- Start with small test amount
- Verify on block explorer

### Can I bridge NFTs?

**ERC-721 bridging coming soon**. For now:
- Use official bridge UI when available
- Or use third-party NFT bridges

### What happens if bridge is down?

Deposits and withdrawals are **smart contract operations**, not dependent on UI:
- Use block explorer to interact directly
- Or wait for UI to come back online
- Your funds are always safe in contracts

### Can I cancel a withdrawal?

**No**. Once initiated, withdrawals must be completed. You can choose not to finalize, but cannot cancel.

## Security Best Practices

1. **Verify URLs**: Bookmark official bridge
2. **Check Network**: Confirm you're on correct network
3. **Test First**: Bridge small amount first
4. **Review Transaction**: Verify all details before confirming
5. **Save Transaction Hash**: Keep for tracking
6. **Be Patient**: Don't panic if withdrawal takes time

::: danger Beware of Scams
- Never share your seed phrase
- Only use official bridge at bridge.jeju.network
- Be suspicious of "support" contacting you
- Double-check all contract addresses
:::

## Support

**Bridge Issues?**
- [Discord #bridge-support](https://discord.gg/jeju)
- [Submit ticket](https://support.jeju.network)
- [Check status](https://status.jeju.network)

**Track Your Bridge**:
- [Jeju Bridge UI](https://bridge.jeju.network)
- [Base Explorer](https://basescan.org)
- [Jeju Explorer](https://explorer.jeju.network)

## Next Steps

- [**Wallet Setup**](./wallet-setup) - Configure your wallet
- [**Testnet**](./testnet) - Practice on testnet first
- [**Developer Guide**](/developers/quick-start) - Start building on Jeju

