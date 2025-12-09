# Mainnet

## Network

| Parameter | Value |
|-----------|-------|
| Chain ID | 420691 |
| RPC | https://rpc.jeju.network |
| WebSocket | wss://ws.jeju.network |
| Explorer | https://explorer.jeju.network |
| Settlement | Ethereum (1) |

## Add to MetaMask

- Network: `Jeju`
- RPC: `https://rpc.jeju.network`
- Chain ID: `420691`
- Symbol: `ETH`

## Bridge ETH

1. Get ETH on Ethereum
2. Bridge at https://gateway.jeju.network

## Deploy

```bash
export DEPLOYER_PRIVATE_KEY=0x...

cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.jeju.network \
  --broadcast \
  --verify
```
