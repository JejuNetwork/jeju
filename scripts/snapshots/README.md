# Jeju Snapshot Service

Automated snapshot creation and distribution for Jeju nodes.

## Overview

Snapshots dramatically reduce node sync time from **3-7 days → 2-4 hours**, saving operators hundreds of dollars in compute costs.

## Components

### `create-snapshot.ts`
Creates compressed snapshots of node data and uploads to S3/CDN.

**Features:**
- Graceful node shutdown
- Tar.gz compression
- S3 upload with metadata
- Notifications (Discord/Telegram)
- Automatic cleanup

**Usage:**
```bash
# Configure environment
export S3_BUCKET=jeju-snapshots
export S3_REGION=us-east-1
export DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
export DATA_DIR=/data
export DOCKER_COMPOSE_PATH=~/.jeju

# Run snapshot creation
bun run scripts/snapshots/create-snapshot.ts

# Or use npm script
bun run snapshot:create
```

**Automated via Cron:**
```bash
# Add to crontab (daily at midnight)
0 0 * * * cd /path/to/jeju && bun run scripts/snapshots/create-snapshot.ts
```

### `download-snapshot.sh`
Downloads and applies snapshots during node setup.

**Usage:**
```bash
# Download latest mainnet full node snapshot
bash scripts/snapshots/download-snapshot.sh mainnet full

# Download testnet archive node snapshot  
bash scripts/snapshots/download-snapshot.sh testnet archive

# Or use npm script
bun run snapshot:download
```

## Configuration

Environment variables (see `.env.snapshots.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `JEJU_NETWORK` | Network name | `mainnet` |
| `NODE_TYPE` | Node type | `full` |
| `DATA_DIR` | Node data directory | `/data` |
| `S3_BUCKET` | S3 bucket name | `jeju-snapshots` |
| `S3_REGION` | AWS region | `us-east-1` |
| `DISCORD_WEBHOOK` | Discord notification URL | - |

## Snapshot Format

Snapshots include:
- Reth database (`/data/db/`)
- OP-Node data (`/data/op-node/`)
- Metadata (block number, timestamp, size)

**Excluded:**
- Logs
- Temporary files
- Lock files

## Storage

Snapshots are stored at:
```
s3://jeju-snapshots/
├── mainnet-full-latest.tar.gz
├── mainnet-full-latest.json
├── mainnet-archive-latest.tar.gz
├── mainnet-archive-latest.json
├── testnet-full-latest.tar.gz
└── testnet-full-latest.json
```

## Costs

**Storage:**
- Mainnet full: ~300 GB → ~$7/month S3
- Mainnet archive: ~1.5 TB → ~$35/month S3
- Total: ~$50/month for all snapshots

**Bandwidth:**
- ~$0.09/GB egress
- 100 downloads/day × 300 GB = ~$2,700/month
- Use CloudFront CDN to reduce costs to ~$500/month

## Security

- Snapshots are read-only
- No sensitive data included
- Verify integrity after download
- Use HTTPS for downloads

## Troubleshooting

**Snapshot creation fails:**
- Check disk space (need 2x data size)
- Verify S3 credentials
- Ensure node is healthy before snapshot

**Download fails:**
- Check network connectivity
- Verify snapshot URL is accessible
- Try manual download with wget/curl

**Extract fails:**
- Check disk space
- Verify tar.gz is not corrupted
- Re-download snapshot

## Support

- Docs: https://docs.jeju.network
- Discord: https://discord.gg/jeju
- Issues: https://github.com/jeju-l3/jeju/issues

