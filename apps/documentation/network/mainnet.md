# Jeju Mainnet

Production network for Jeju, settling on Base mainnet. Use this for production dApps with real value.

## Network Details

| Parameter | Value |
|-----------|-------|
| **Network Name** | Jeju |
| **Chain ID** | 420691 |
| **RPC URL** | https://rpc.jeju.network |
| **WebSocket** | wss://ws.jeju.network |
| **Explorer** | https://explorer.jeju.network |
| **Settlement Layer** | Base (8453) |
| **Status** | 🚀 Production |

## Quick Add to Wallet

### MetaMask

Click "Add Network" in MetaMask and enter:

```
Network Name: Jeju
RPC URL: https://rpc.jeju.network
Chain ID: 420691
Currency Symbol: ETH
Block Explorer: https://explorer.jeju.network
```

Or use this one-click link:
[Add Jeju to MetaMask](https://chainlist.org/chain/420691)

### Manual Configuration

```typescript
// wagmi/viem configuration
import { defineChain } from 'viem';

export const jeju = defineChain({
  id: 420691,
  name: 'Jeju',
  network: 'jeju',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.jeju.network'],
      webSocket: ['wss://ws.jeju.network'],
    },
    public: {
      http: ['https://rpc.jeju.network'],
      webSocket: ['wss://ws.jeju.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: 'https://explorer.jeju.network',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 1,
    },
  },
});
```

## Get ETH on Jeju

### Method 1: Bridge from Base (Recommended)

1. Get ETH on Base (bridge from Ethereum via [Superbridge](https://superbridge.app))
2. Bridge Base → Jeju using [Jeju Bridge](https://bridge.jeju.network)
3. Bridging takes ~5 minutes

### Method 2: Bridge from Ethereum (2-step)

1. Bridge Ethereum → Base using [Superbridge](https://superbridge.app)
2. Bridge Base → Jeju using [Jeju Bridge](https://bridge.jeju.network)

### Method 3: On-Ramps (Direct Purchase)

Buy ETH directly on Jeju (no bridging required):

- **MoonPay**: https://www.moonpay.com
- **Ramp**: https://ramp.network
- **Transak**: https://transak.com

*Coming soon - check back for direct on-ramp support*

## RPC Endpoints

### Public RPC (Free, Rate Limited)

Free public RPC endpoints provided by Jeju:

```bash
# HTTP
https://rpc.jeju.network

# WebSocket  
wss://ws.jeju.network

# Rate Limits
- 100 requests per second per IP
- 5,000 requests per minute per IP
- Burst: 200 requests
- Unlimited requests per day
```

**Best for**: Development, testing, low-traffic dApps

### Production Use

For production dApps with high traffic, we recommend:

**Run Your Own Node** (Recommended):
- No rate limits
- Maximum decentralization
- Full control over infrastructure
- Archive node support
- See [Running Your Own RPC Node](/developers/run-rpc-node) guide

**Benefits of Self-Hosting**:
- ✅ No rate limits
- ✅ Lower latency (deploy in your region)
- ✅ Complete privacy (no third-party tracking)
- ✅ Cost-effective at scale (>500K requests/day)
- ✅ Access to archive data and debug methods

::: tip Free Public RPC
Our public RPC is completely free and suitable for most applications. Only high-traffic production dApps need to consider self-hosting.
:::

## Network Information

### Block Production
- **Block Time**: 2 seconds
- **Sub-block Time**: 200ms (Flashblocks)
- **Gas Limit**: 30,000,000 gas
- **Gas Target**: 15,000,000 gas
- **EIP-1559**: Enabled

### Settlement
- **Settlement Layer**: Base Mainnet (8453)
- **Batch Interval**: ~10 minutes
- **State Root Interval**: ~1 hour
- **Challenge Period**: 7 days on Base + 7 days Base→Ethereum

### Data Availability
- **Primary**: EigenDA mainnet
- **Fallback**: Base mainnet calldata
- **Data Retention**: Permanent (archived)

### Gas Fees

Typical transaction gas usage:

| Transaction Type | Gas Used |
|-----------------|----------|
| ETH Transfer | ~21,000 |
| ERC-20 Transfer | ~65,000 |
| Uniswap Swap | ~150,000 |
| NFT Mint | ~80,000 |
| Contract Deploy | ~500,000 |

Gas prices on Jeju are extremely low due to L3 architecture.

::: tip Ultra-Low Fees
Jeju's L3 architecture means fees are typically 10-100x cheaper than Base, and 100-1000x cheaper than Ethereum.
:::

## Contract Addresses

### Core L3 Contracts (on Jeju)

<ContractAddresses network="mainnet" layer="l2" />

### L1 Contracts (on Base Mainnet)

<ContractAddresses network="mainnet" layer="l1" />

### DeFi Contracts

See [Contract Addresses](/contracts) for complete list of DeFi protocols.

## Network Status

### Live Monitoring

**Status Dashboard**: https://status.jeju.network

Real-time metrics:
- ✅ Block production
- ✅ RPC health  
- ✅ Settlement status
- ✅ Sequencer uptime
- ✅ Bridge status

### Incidents & Updates

- **Twitter**: [@jejunetwork](https://twitter.com/jejunetwork)
- **Discord**: [#announcements](https://discord.gg/jeju)
- **Status Page**: https://status.jeju.network

## Security

### Audit Reports

All smart contracts undergo comprehensive security audits before mainnet deployment. Audit reports are published for transparency.

### Bug Bounty

**Program**: Immunefi  
**Details**: https://immunefi.com/bounty/jeju

Active bug bounty program with significant rewards for valid security findings.

Report security issues:
- **Email**: security@jeju.network
- **Responsible Disclosure**: security@jeju.network

### Multisig Addresses

- **Operations**: `0x...` (3-of-5)
- **Upgrades**: `0x...` (5-of-9, 48hr timelock)
- **Emergency**: `0x...` (3-of-5, no timelock)

### Withdrawals

**Standard Withdrawal** (7 days + 7 days):
1. Initiate on Jeju
2. Wait 7 days (Base challenge period)
3. Prove on Base
4. Wait 7 days (Ethereum challenge period)
5. Finalize withdrawal

**Fast Withdrawal** (~15 minutes):
Use third-party bridges:
- [Hop Protocol](https://hop.exchange)
- [Across Protocol](https://across.to)
- *Small fee applies for instant liquidity*

## Developer Resources

### Block Explorer

**Main Explorer**: https://explorer.jeju.network

Features:
- Transaction tracking
- Contract verification
- Token analytics
- API access
- Real-time updates

### API Endpoints

```bash
# JSON-RPC
https://rpc.jeju.network

# WebSocket
wss://ws.jeju.network

# Explorer API
https://explorer.jeju.network/api

# GraphQL (The Graph)
https://graph.jeju.network/subgraphs
```

### Smart Contract Development

```bash
# Deploy with Foundry
forge create YourContract \
  --rpc-url https://rpc.jeju.network \
  --private-key $PRIVATE_KEY \
  --verify

# Verify on explorer
forge verify-contract $CONTRACT_ADDRESS YourContract \
  --chain-id 420691 \
  --etherscan-api-key $EXPLORER_API_KEY
```

## Best Practices

### For dApp Developers

1. **Use Premium RPC**: Don't rely on public endpoints for production
2. **Monitor Gas**: Implement gas price monitoring
3. **Handle Reorgs**: Sub-second blocks = handle reorgs properly
4. **Test Thoroughly**: Extensive testnet testing before mainnet
5. **Implement Fallbacks**: Handle RPC failures gracefully

### For Users

1. **Verify Addresses**: Always double-check recipient addresses
2. **Start Small**: Test with small amounts first
3. **Check Explorer**: Confirm transactions on block explorer
4. **Secure Keys**: Use hardware wallets for large amounts
5. **Beware Scams**: Only use official bridge at bridge.jeju.network

### Security Checklist

- [ ] Contracts professionally audited
- [ ] Emergency pause mechanism implemented
- [ ] Upgrade process tested on testnet
- [ ] Monitoring and alerting configured
- [ ] Incident response plan documented
- [ ] Multi-sig for admin functions
- [ ] Timelock for upgrades
- [ ] Bug bounty program active

## Support

### Documentation

- **Developer Guide**: [/developers/quick-start](/developers/quick-start)
- **Contract Reference**: [/contracts](/contracts)
- **API Docs**: https://docs.jeju.network

### Community

- **Discord**: [Join Community](https://discord.gg/jeju)
- **Telegram**: [t.me/jejunetwork](https://t.me/jejunetwork)
- **Twitter**: [@jejunetwork](https://twitter.com/jejunetwork)
- **Forum**: [forum.jeju.network](https://forum.jeju.network)

### Enterprise Support

For enterprise integrations:
- **Email**: enterprise@jeju.network
- **Calendar**: [Book a call](https://cal.com/jeju)

## Next Steps

- [**Wallet Setup**](./wallet-setup) - Configure your wallet
- [**Bridge Assets**](./bridge) - Move assets to Jeju
- [**Deploy Contracts**](/developers/deploy-contracts) - Build on Jeju
- [**DeFi Protocols**](/developers/defi-protocols) - Integrate with DeFi

