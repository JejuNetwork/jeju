# RPC Methods

Jeju supports all standard Ethereum JSON-RPC methods.

## Standard Methods

### eth_blockNumber
```bash
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### eth_getBalance
```bash
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x...","latest"],"id":1}'
```

### eth_sendRawTransaction
```bash
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0x..."],"id":1}'
```

## Supported APIs

- `eth` - Ethereum standard methods
- `net` - Network information
- `web3` - Web3 client version
- `txpool` - Transaction pool (some nodes)
- `trace` - Transaction tracing (archive nodes only)

## Rate Limits

### Public RPC
- 100 requests/second per IP
- 5,000 requests/minute per IP
- Burst: 200 requests

### Your Own Node
- No rate limits
- See [Run RPC Node](./run-rpc-node.md)

## Resources

- [Quick Start](./quick-start.md)
- [Network Information](/network/testnet)
- [Run Your Own Node](./run-rpc-node.md)


