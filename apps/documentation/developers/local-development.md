# Local Development

## Start

```bash
bun run dev              # Full stack
bun run dev -- --minimal # Chain only
```

## Services

| Service | URL |
|---------|-----|
| L2 RPC | http://127.0.0.1:9545 |
| L1 RPC | http://127.0.0.1:8545 |
| GraphQL | http://127.0.0.1:4350/graphql |
| Gateway | http://127.0.0.1:4001 |
| Bazaar | http://127.0.0.1:4006 |

## Test Account

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Contracts

```bash
cd packages/contracts
forge test         # Run tests
forge build        # Compile
forge test -vvv    # Verbose
```

Deploy to localnet:

```bash
forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:9545
```

## Debugging

```bash
# Check RPC
curl -X POST http://127.0.0.1:9545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# View logs
kurtosis service logs jeju-localnet el-1-op-reth-op-node
```

## Reset

```bash
kurtosis clean -a
bun run dev
```
