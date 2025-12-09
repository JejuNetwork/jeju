# Testnet

## Network

| Parameter | Value |
|-----------|-------|
| Chain ID | 420690 |
| RPC | https://testnet-rpc.jeju.network |
| WebSocket | wss://testnet-ws.jeju.network |
| Explorer | https://testnet-explorer.jeju.network |
| Settlement | Sepolia (11155111) |

## Add to MetaMask

- Network: `Jeju Testnet`
- RPC: `https://testnet-rpc.jeju.network`
- Chain ID: `420690`
- Symbol: `ETH`

## Get Testnet ETH

1. Get Sepolia ETH: https://sepoliafaucet.com
2. Bridge to Jeju: https://testnet-gateway.jeju.network

## Deploy

```bash
export DEPLOYER_PRIVATE_KEY=0x...

cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast
```
