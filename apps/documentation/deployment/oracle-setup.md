# Oracle Setup

Price bot fetches ETH/USD from Chainlink on Ethereum and elizaOS/USD from DEXes, pushes to ManualPriceOracle on Jeju every 5 minutes.

## Deploy

```bash
cd contracts
forge script script/DeployLiquiditySystem.s.sol --broadcast --verify
```

## Configure

`.env.oracle`:
```bash
ETHEREUM_RPC_URL=https://eth.llamarpc.com
JEJU_RPC_URL=https://rpc.jeju.network
ORACLE_ADDRESS=0x...
ELIZAOS_TOKEN_BASE=0x...
PRICE_UPDATER_PRIVATE_KEY=0x...
```

Fund updater wallet with ~0.1 ETH on Jeju (enough for years).

## Authorize Updater

```bash
cast send $ORACLE_ADDRESS "setPriceUpdater(address)" $UPDATER_ADDRESS \
  --rpc-url $JEJU_RPC_URL --private-key $OWNER_PRIVATE_KEY
```

## Run

**Docker (production)**:
```bash
docker build -f Dockerfile.oracle -t jeju-oracle-bot .
docker run -d --restart unless-stopped --name oracle-bot jeju-oracle-bot
```

**Systemd**:
```ini
[Unit]
Description=Jeju Oracle Price Updater
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/jeju
ExecStart=/usr/bin/bun run scripts/oracle-updater.ts
Restart=always
EnvironmentFile=/home/ubuntu/jeju/.env.oracle

[Install]
WantedBy=multi-user.target
```

## Verify

```bash
cast call $ORACLE_ADDRESS "getPrices()" --rpc-url $JEJU_RPC_URL
cast call $ORACLE_ADDRESS "isPriceFresh()" --rpc-url $JEJU_RPC_URL
```

## Safety

- 50% max deviation per update
- 1-hour staleness threshold (paymaster auto-pauses)
- Rate limited (max 1 update/min)
- Run 2-3 redundant bots for failover
