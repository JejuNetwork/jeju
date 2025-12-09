# Uniswap V4 Testnet Deployment

Network: Jeju Testnet (420690)  
Time: 15-30 min

## Prerequisites

- [ ] Bun, Foundry installed
- [ ] 0.5+ ETH on deployer account
- [ ] Testnet RPC accessible

```bash
bun --version && forge --version
cast balance $DEPLOYER --rpc-url https://testnet-rpc.jeju.network
```

## Deploy

```bash
cd /path/to/jeju
git pull && git submodule update --init --recursive

export PRIVATE_KEY="0x..."
export JEJU_NETWORK="testnet"

bun run scripts/deploy-uniswap-v4.ts
```

Output: PoolManager address saved to `packages/contracts/deployments/uniswap-v4-420690.json`

## Verify

```bash
bun run scripts/verify-uniswap-v4-deployment.ts --network testnet

# Manual check
cast call $POOL_MANAGER "owner()" --rpc-url https://testnet-rpc.jeju.network
```

## Troubleshooting

**Insufficient balance**: Get more testnet ETH from faucet or bridge from Sepolia  
**RPC fails**: Check network status, try alternative RPC  
**Deployment fails**: `forge clean && forge build --use 0.8.26`

## Next Steps

- Update app configs with PoolManager address
- Test pool initialization (see uniswap-v4-pool-initialization.md)
- Deploy hooks if needed
