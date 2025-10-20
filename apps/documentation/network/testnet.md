# Jeju Testnet

Connect to Jeju's public testnet for development and testing. The testnet settles on Base Sepolia and is perfect for testing your dApps before mainnet deployment.

## Network Details

| Parameter | Value |
|-----------|-------|
| **Network Name** | Jeju Testnet |
| **Chain ID** | 420690 |
| **RPC URL** | https://testnet-rpc.jeju.network |
| **WebSocket** | wss://testnet-ws.jeju.network |
| **Explorer** | https://testnet-explorer.jeju.network |
| **Settlement Layer** | Base Sepolia (84532) |
| **Status** | ✅ Live & Stable |

## Quick Add to Wallet

### MetaMask

Click "Add Network" in MetaMask and enter:

```
Network Name: Jeju Testnet
RPC URL: https://testnet-rpc.jeju.network
Chain ID: 420690
Currency Symbol: ETH
Block Explorer: https://testnet-explorer.jeju.network
```

Or use this one-click link:
[Add Jeju Testnet to MetaMask](https://chainlist.org/chain/420690)

### Manual Configuration

```typescript
// wagmi/viem configuration
import { defineChain } from 'viem';

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  network: 'jeju-testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.jeju.network'],
      webSocket: ['wss://testnet-ws.jeju.network'],
    },
    public: {
      http: ['https://testnet-rpc.jeju.network'],
      webSocket: ['wss://testnet-ws.jeju.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: 'https://testnet-explorer.jeju.network',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 1,
    },
  },
  testnet: true,
});
```

## Get Testnet ETH

### Method 1: Bridge from Sepolia

1. Get Sepolia ETH from [Ethereum Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
2. Bridge Sepolia → Base Sepolia using [Superbridge](https://superbridge.app)
3. Bridge Base Sepolia → Jeju Testnet using [Jeju Bridge](https://testnet-bridge.jeju.network)

### Method 2: Jeju Faucet (Coming Soon)

Direct faucet for Jeju Testnet (no bridging required):
- Visit: https://faucet.jeju.network
- Connect wallet
- Request 0.1 ETH per day

### Method 3: Request from Discord

For larger amounts:
1. Join [Discord](https://discord.gg/jeju)
2. Go to #testnet-faucet
3. Share your address and use case
4. Team will send testnet ETH

## RPC Endpoints

### Public RPC (Free, Rate Limited)

Free public RPC endpoints provided by Jeju:

```bash
# HTTP
https://testnet-rpc.jeju.network

# WebSocket
wss://testnet-ws.jeju.network

# Rate Limits
- 50 requests per second per IP
- 2,000 requests per minute per IP
- Burst: 100 requests
- Unlimited requests per day
```

**Best for**: All testnet development and testing

::: tip Testnet Rate Limits
Testnet rate limits are intentionally relaxed to make development easy. If you need higher limits, please reach out in Discord.
:::

### Need Higher Limits?

For intensive testing or CI/CD pipelines:

**Run Your Own Testnet Node**:
- Deploy a testnet node for your team
- No rate limits
- See [Running Your Own RPC Node](/developers/run-rpc-node) guide
- Cost: ~$750/month (or run locally for free)

**Request Increased Limits**:
- Join [Discord](https://discord.gg/jeju)
- Share your use case in #testnet-support
- Team can whitelist your IP for higher limits

## Network Information

### Block Production
- **Block Time**: 2 seconds
- **Sub-block Time**: 200ms (Flashblocks)
- **Gas Limit**: 30,000,000
- **Gas Target**: 15,000,000

### Settlement
- **Settlement Layer**: Base Sepolia
- **Batch Interval**: ~10 minutes
- **State Root Interval**: ~1 hour
- **Challenge Period**: 7 days

### Data Availability
- **Primary**: EigenDA (Holesky testnet)
- **Fallback**: Base Sepolia calldata
- **Data Retention**: 30 days minimum

## Contract Addresses

### Core L3 Contracts (on Jeju Testnet)

<ContractAddresses network="testnet" layer="l2" />

### L1 Contracts (on Base Sepolia)

<ContractAddresses network="testnet" layer="l1" />

See [Contract Addresses](/contracts) for complete list including DeFi protocols.

## Developer Tools

### Block Explorers

- **Main Explorer**: https://testnet-explorer.jeju.network
- **Contract Verification**: Supported
- **API**: Available at `/api` endpoint

### Testing Tools

```bash
# Cast (Foundry CLI)
cast block latest --rpc-url https://testnet-rpc.jeju.network

# Send transaction
cast send $CONTRACT_ADDRESS "function()" \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY

# Deploy contract with Forge
forge create Contract \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### Debugging

```typescript
// Enable verbose logging
const provider = new ethers.JsonRpcProvider(
  'https://testnet-rpc.jeju.network',
  {
    name: 'jeju-testnet',
    chainId: 420690,
  }
);

// Get transaction trace
const trace = await provider.send('debug_traceTransaction', [txHash]);
```

## Network Status

### Health Dashboard

Monitor network health: https://status.jeju.network

Metrics:
- Block production rate
- RPC response time
- Settlement status
- Data availability
- Sequencer uptime

### Known Issues

::: warning Current Limitations
- **No Fault Proofs Yet**: Testnet runs in "training wheels" mode
- **Centralized Sequencer**: Single sequencer operated by team
- **No Withdrawals**: Withdrawal functionality not enabled yet
- **Resets**: Testnet may be reset periodically
:::

### Upcoming Features

- ✅ EigenDA integration (live)
- ✅ Flashblocks (live)
- 🚧 Fault proofs (Q2 2025)
- 🚧 Multi-sequencer (Q3 2025)
- 🚧 Fast withdrawals (Q3 2025)

## Best Practices

### Testing Your dApp

1. **Start Local**: Use localnet for development
2. **Move to Testnet**: Test with real network conditions
3. **Get Feedback**: Share with community for testing
4. **Monitor Performance**: Use block explorer and logs
5. **Test Edge Cases**: Network congestion, reorgs, etc.

### Gas Optimization

```solidity
// Testnet gas is cheap, but optimize for mainnet:
- Use calldata instead of memory where possible
- Batch transactions
- Use efficient data structures
- Test gas usage with hardhat-gas-reporter
```

### Security

::: danger Never Use Real Funds
Testnet is for TESTING ONLY. Never send real assets or use production keys.
:::

- Use separate wallets for testnet
- Never reuse production private keys
- Assume testnet data can be reset
- Don't store sensitive data on testnet
- Use Anvil locally for development before testnet

## Support

### Getting Help

- **Discord**: [#testnet-support](https://discord.gg/jeju)
- **GitHub**: [Report issues](https://github.com/elizaos/jeju/issues)
- **Docs**: [Developer Guide](/developers/quick-start)
- **Status**: https://status.jeju.network

### Common Issues

**Transaction stuck?**
- Check gas price: might be too low
- Check nonce: might be incorrect
- View in explorer: confirm status

**Can't connect to RPC?**
- Check rate limits
- Try different RPC endpoint
- Verify network is operational

**No testnet ETH?**
- Try faucet again (daily limit)
- Request in Discord
- Bridge from Sepolia

## Next Steps

- [**Wallet Setup**](./wallet-setup) - Configure your wallet
- [**Bridge Assets**](./bridge) - Move assets between chains
- [**Deploy Contracts**](/developers/deploy-contracts) - Deploy your first contract
- [**Mainnet**](./mainnet) - When ready for production

