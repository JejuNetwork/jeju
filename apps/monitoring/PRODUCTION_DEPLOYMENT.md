# Production Deployment Guide

## Monitoring Setup

### Prerequisites

1. **Alertmanager Webhook Endpoint**: Must be configured before deployment
   - Set `ALERT_WEBHOOK_URL` environment variable
   - Set `CRITICAL_ALERT_WEBHOOK_URL` for critical alerts
   - Set `WARNING_ALERT_WEBHOOK_URL` for warnings
   - Default: `http://localhost:9094/webhook` (will fail if not configured)

2. **SMTP Configuration** (optional, for email alerts):
   - `SMTP_HOST`: SMTP server (default: `localhost:587`)
   - `SMTP_USER`: SMTP username
   - `SMTP_PASSWORD`: SMTP password
   - `ALERT_FROM`: From address (default: `alerts@jeju.network`)

3. **Prometheus → Alertmanager Integration**:
   - Prometheus is configured to send alerts to `alertmanager:9093`
   - Both services must be on the same Docker network (`jeju-monitoring`)

### Failure Modes

#### Alertmanager Webhook Failures

**Symptom**: Alerts fire but no notifications received

**Causes**:
- Webhook URL not configured (defaults to `localhost:9094/webhook`)
- Webhook endpoint unreachable or down
- Network connectivity issues between Alertmanager and webhook

**Detection**:
- Check Alertmanager logs: `docker logs jeju-alertmanager`
- Check Prometheus alerts: `http://localhost:9090/alerts`
- Verify webhook endpoint is accessible from Alertmanager container

**Mitigation**:
- Configure `ALERT_WEBHOOK_URL` environment variable before deployment
- Set up a monitoring webhook endpoint that logs all alerts
- Use Alertmanager's built-in retry mechanism (configured with 10s timeout)

#### Prometheus → Alertmanager Connection Failures

**Symptom**: Prometheus shows "alertmanager unreachable" errors

**Causes**:
- Alertmanager container not running
- Network misconfiguration
- Port 9093 not accessible

**Detection**:
- Check Prometheus targets: `http://localhost:9090/targets`
- Check Alertmanager health: `http://localhost:9093/-/healthy`
- Verify both containers on same network: `docker network inspect jeju-monitoring`

**Mitigation**:
- Ensure Alertmanager starts before Prometheus (configured via `depends_on`)
- Verify network configuration in `docker-compose.yml`
- Check firewall rules allow port 9093

### Assumptions

1. **Docker Network**: All monitoring services assume `jeju-monitoring` network exists
2. **Host Networking**: Services use `host.docker.internal` to reach host services
3. **Webhook Availability**: Alertmanager assumes webhook endpoint is always available
4. **SMTP Availability**: Email alerts assume SMTP server is configured and reachable
5. **Port Availability**: Assumes ports 9090 (Prometheus), 9093 (Alertmanager), 4010 (Grafana) are free

### Configuration Validation

Run before deployment:
```bash
# Validate docker-compose config
cd apps/monitoring && docker-compose config

# Validate Prometheus config
docker run --rm -v $(pwd)/prometheus:/etc/prometheus prom/prometheus:latest promtool check config /etc/prometheus/prometheus.yml

# Validate Alertmanager config
docker run --rm -v $(pwd)/alertmanager:/etc/alertmanager prom/alertmanager:latest amtool check-config /etc/alertmanager/alertmanager.yml
```

## Security Overrides

### Verified Packages

The following packages have been verified to upgrade via `package.json` overrides:

- `form-data`: Upgraded to 4.0.5 (>=4.0.0 required)
- `morgan`: Override in place (>=1.10.0)
- `uglify-js`: Override in place (>=3.19.0)
- `next`: Override in place (>=15.1.0)

### Unverified Packages

Some packages may still have vulnerabilities in nested dependencies:
- Vendor packages (`eliza-otc-desk`, `eliza-cloud-v2`) may contain vulnerable nested deps
- Overrides may not apply to deeply nested dependencies

**Verification**:
```bash
# Check installed versions
bun pm ls <package-name>

# Run security audit
bun audit
```

## Wake Page Funding Test

### Test Configuration

The wake page funding test (`packages/tests/e2e/jns-gateway.spec.ts`) requires:

1. **Unfunded App**: Set `WAKE_PAGE_TEST_APP` environment variable to an unfunded JNS name
2. **Wallet with Funds**: Test wallet must have ETH to fund the keepalive
3. **Contract Interaction**: Requires deployed `KeepaliveRegistry` contract

### Running the Test

```bash
# With specific unfunded app
WAKE_PAGE_TEST_APP=test-app.jeju bun test packages/tests/e2e/jns-gateway.spec.ts

# Test will skip if wake page not shown (app may be funded)
```

### Failure Modes

- **Wake page not shown**: App may be funded or not registered → Test skips gracefully
- **Wallet not connected**: Test will fail → Ensure MetaMask is configured
- **Insufficient funds**: Transaction will fail → Fund test wallet
- **Contract not deployed**: Test will fail → Deploy KeepaliveRegistry first

## Rollback Procedures

See `scripts/test-rollback.ts` for rollback verification.

### Kubernetes Rollback

```bash
# Rollback deployment
kubectl rollout undo deployment/<service-name>

# Check rollback status
kubectl rollout status deployment/<service-name>
```

### Configuration Rollback

Backups are stored in `.rollback-test-backups/`:
- Config backups: `config-backup-<timestamp>.json`
- Test backups: `test-backup.json`

## Known Limitations

1. **Vendor Package Vulnerabilities**: 17 vulnerabilities remain in vendor packages (cannot be fixed via overrides)
2. **Webhook Default**: Alertmanager defaults to `localhost:9094/webhook` which may not exist
3. **SMTP Default**: Email alerts default to `localhost:587` which may not be configured
4. **Network Dependencies**: Monitoring assumes specific network topology (Docker networks)
