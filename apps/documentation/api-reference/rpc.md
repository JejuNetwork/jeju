# RPC Methods

Jeju is Ethereum-compatible. Standard JSON-RPC methods work as expected.

## Endpoints

Localnet uses `http://127.0.0.1:9545` with WebSocket at `ws://127.0.0.1:9546`. Testnet uses `https://testnet-rpc.jeju.network` with WebSocket at `wss://testnet-ws.jeju.network`. Mainnet uses `https://rpc.jeju.network` with WebSocket at `wss://ws.jeju.network`.

## Standard Methods

All standard Ethereum JSON-RPC methods are supported.

### eth_blockNumber

Get the latest block number:

```bash
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### eth_getBalance

Get account balance:

```bash
curl -X POST https://rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","latest"],"id":1}'
```

### eth_sendRawTransaction

Submit signed transaction.

### eth_call

Execute read-only contract call.

### eth_getLogs

Query event logs.

## OP-Stack Methods

### optimism_outputAtBlock

Get L2 output at specific block (for withdrawals).

### optimism_syncStatus

Get sequencer sync status.

## Debug Methods

Available on localnet and testnet. Use `debug_traceTransaction` for transaction traces and `debug_traceCall` for call traces.

## Using with Libraries

### viem

```typescript
import { createPublicClient, http } from 'viem';
import { jeju } from './chains';

const client = createPublicClient({
  chain: jeju,
  transport: http('https://rpc.jeju.network'),
});

const balance = await client.getBalance({
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
});
```

### ethers

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://rpc.jeju.network');
const balance = await provider.getBalance('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
```

### cast (Foundry)

```bash
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url https://rpc.jeju.network
cast block latest --rpc-url https://rpc.jeju.network
cast call $CONTRACT "balanceOf(address)" $USER --rpc-url https://rpc.jeju.network
```

## WebSocket Subscriptions

### Subscribe to New Blocks

```javascript
const ws = new WebSocket('wss://ws.jeju.network');

ws.send(JSON.stringify({
  jsonrpc: '2.0',
  method: 'eth_subscribe',
  params: ['newHeads'],
  id: 1,
}));

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New block:', data.params.result.number);
};
```

### Subscribe to Logs

Subscribe to contract events with address and topics filters.

## Rate Limits

Public tier allows 10 requests/sec with 50 burst. Registered tier allows 100 requests/sec with 500 burst. Premium tier allows 1000 requests/sec with 5000 burst. Rate limit headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Errors

Code -32600 is Invalid Request (malformed JSON). Code -32601 is Method not found. Code -32602 is Invalid params. Code -32603 is Internal error. Code -32000 is Server error (execution reverted).
