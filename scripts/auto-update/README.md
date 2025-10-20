# Jeju Auto-Update Manager

Automatically keep Jeju nodes updated to the latest versions with zero downtime.

## Overview

The auto-update manager:
- ✅ Checks GitHub for new releases
- ✅ Downloads and verifies images
- ✅ Creates backups before updates
- ✅ Performs rolling updates
- ✅ Verifies health after update
- ✅ Automatic rollback on failure
- ✅ Notifications on completion

## Features

### Zero Downtime
- Rolling updates keep node running
- Health checks verify service stability
- Automatic rollback if issues detected

### Safety First
- Backups before every update (keeps last 3)
- Health verification after update
- Rollback on verification failure
- No data loss

### Notifications
- Discord/Telegram alerts
- Update success/failure notifications
- Manual intervention alerts

## Usage

### Manual Mode (Check Only)

```bash
# Check for updates but don't apply
AUTO_UPDATE=false bun run update:auto

# Or use dedicated command
bun run update:check
```

### Automatic Mode

```bash
# Enable auto-updates
AUTO_UPDATE=true bun run update:auto

# Or use helper script
AUTO_UPDATE=true ~/.jeju/update.sh
```

### Production Deployment

**Systemd Service:**
```ini
# /etc/systemd/system/jeju-auto-update.service
[Unit]
Description=Jeju Auto-Update Manager
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/jeju
ExecStart=/usr/bin/bun run scripts/auto-update/update-manager.ts
Restart=always
RestartSec=10
Environment="AUTO_UPDATE=true"
Environment="NOTIFICATION_WEBHOOK=https://discord.com/api/webhooks/..."
EnvironmentFile=/home/ubuntu/jeju/.env.auto-update

[Install]
WantedBy=multi-user.target
```

**Docker:**
```bash
docker build -f scripts/auto-update/Dockerfile -t jeju-auto-update .
docker run -d \
  -e AUTO_UPDATE=true \
  -e DOCKER_COMPOSE_PATH=/root/.jeju \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.jeju:/root/.jeju \
  jeju-auto-update
```

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTO_UPDATE` | Enable automatic updates | `false` |
| `UPDATE_CHECK_INTERVAL` | Check interval (ms) | `3600000` (1h) |
| `DOCKER_COMPOSE_PATH` | Path to node config | `~/.jeju` |
| `GITHUB_REPO` | GitHub repository | `jeju-l3/jeju` |
| `BACKUP_COUNT` | Number of backups to keep | `3` |
| `NOTIFICATION_WEBHOOK` | Discord/Telegram webhook | - |

## Update Process

1. **Check for Updates**
   - Queries GitHub releases API
   - Compares with current version
   - Logs availability

2. **Backup Current State**
   - Copies docker-compose.yml
   - Copies version.json
   - Stores in `~/.jeju/backups/`

3. **Pull New Images**
   - Downloads Reth image
   - Downloads OP-Node image
   - Verifies images exist

4. **Update Configuration**
   - Updates docker-compose.yml with new versions
   - Preserves all custom settings

5. **Restart Services**
   - Rolling restart (zero downtime)
   - Health checks verify services
   - Waits for services to be ready

6. **Verify Update**
   - RPC connectivity check
   - Block number check
   - Service health check

7. **Rollback on Failure** (if needed)
   - Restores docker-compose.yml from backup
   - Restarts with old version
   - Sends failure notification

8. **Cleanup**
   - Removes old backups (keeps last 3)
   - Saves new version info

## Version Tracking

Version information stored in `~/.jeju/version.json`:

```json
{
  "reth": "v1.0.3",
  "opNode": "v1.7.6",
  "timestamp": 1704067200000
}
```

## Backups

Backups stored in `~/.jeju/backups/`:

```
backups/
├── 2025-10-17T10-00-00/
│   ├── docker-compose.yml
│   └── version.json
├── 2025-10-16T10-00-00/
└── 2025-10-15T10-00-00/
```

Only last 3 backups retained.

## Notifications

Example notification:

```
✅ Jeju Node Auto-Update

Starting update to Reth v1.0.4 / OP-Node v1.7.7
```

On failure:

```
❌ Jeju Node Auto-Update

Update failed and was rolled back

Error: Services failed health check
```

## Monitoring

Health check endpoint: `http://localhost:3000/health`

Response:
```json
{
  "status": "ok",
  "currentVersion": {
    "reth": "v1.0.3",
    "opNode": "v1.7.6"
  },
  "lastCheck": 1704067200000,
  "autoUpdateEnabled": true
}
```

## Manual Rollback

If auto-rollback fails:

```bash
cd ~/.jeju
cp backups/YYYY-MM-DDTHH-MM-SS/docker-compose.yml ./
docker-compose up -d
```

## Best Practices

1. **Enable Notifications** - Know when updates happen
2. **Test on Testnet First** - Verify updates work
3. **Monitor Logs** - Check for issues
4. **Keep Backups** - Don't delete backup directory
5. **Manual Review** - Review release notes before enabling auto-update

## Troubleshooting

**Updates not being detected:**
- Check GitHub API rate limits
- Verify GITHUB_REPO is correct
- Check network connectivity

**Update fails:**
- Check Docker has permission to pull images
- Verify disk space available
- Check Docker Compose version

**Rollback fails:**
- Manually restore from backup (see above)
- Contact support on Discord

## Support

- **Docs:** `documentation/operators/node-operator-handbook.md`
- **Discord:** https://discord.gg/jeju (#auto-updates)
- **GitHub:** https://github.com/jeju-l3/jeju/issues

