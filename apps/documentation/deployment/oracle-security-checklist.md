# Oracle Security Checklist

## Overview

This checklist ensures your Jeju oracle infrastructure is secure and follows security best practices. Oracle bots have privileged access to update prices, making them potential attack targets. This guide covers infrastructure security, key management, network security, monitoring, and incident response.

**Threat Model**: The oracle system is vulnerable to:
- Price manipulation attacks
- Bot compromise (stolen private keys)
- Network attacks (MITM, DDoS)
- Infrastructure compromise (cloud account, VPS)
- Social engineering

## Pre-Deployment Security

### Infrastructure Setup

- [ ] **Use dedicated cloud accounts for oracle infrastructure**
  - Separate from other services to limit blast radius
  - Enable MFA on all cloud accounts
  - Use least-privilege IAM policies
  - Audit cloud account regularly

- [ ] **Choose reputable infrastructure providers**
  - AWS, GCP, Hetzner, DigitalOcean, etc.
  - Avoid unknown/untrusted providers
  - Check provider's security certifications (SOC 2, ISO 27001)

- [ ] **Deploy bots in different regions/providers**
  - Primary: AWS us-east-1
  - Backup: Hetzner Europe
  - Optional: GCP asia-northeast1
  - Reduces single point of failure

- [ ] **Use infrastructure-as-code (Terraform)**
  - Version control all infrastructure configs
  - Code review infrastructure changes
  - Automated deployment reduces human error
  - Easy disaster recovery

### Private Key Management

- [ ] **Generate oracle bot keys securely**
  ```bash
  # Use cast wallet with strong entropy
  cast wallet new

  # Store in secure location immediately
  # NEVER commit to git, NEVER share
  ```

- [ ] **Use separate keys for each bot**
  - Bot 1: Different key than Bot 2
  - Easier to revoke if compromised
  - Limits damage from single key theft

- [ ] **Store private keys in secrets management**
  - AWS Secrets Manager (recommended)
  - HashiCorp Vault
  - GCP Secret Manager
  - Azure Key Vault
  - **NOT** in .env files on disk

- [ ] **Use hardware security modules (HSM) for production**
  - AWS CloudHSM
  - YubiHSM 2
  - Ledger/Trezor for owner key
  - Protects against key extraction

- [ ] **Limit oracle bot permissions**
  - Bot wallet can ONLY call `updatePrices()`
  - Cannot change oracle config
  - Cannot pause contracts
  - Cannot withdraw funds
  - Owner wallet has admin functions

- [ ] **Rotate bot keys periodically**
  - Every 3-6 months
  - Document rotation procedure
  - Test rotation on testnet first

### Access Control

- [ ] **SSH key-only access (disable passwords)**
  ```bash
  # In /etc/ssh/sshd_config
  PasswordAuthentication no
  PubkeyAuthentication yes
  PermitRootLogin no
  ```

- [ ] **Use strong SSH keys**
  - ED25519 or RSA 4096-bit
  - Passphrase-protected
  - One key per person (not shared)

- [ ] **Implement bastion host/jump server**
  - Oracle nodes not directly accessible
  - All access through hardened bastion
  - Log all SSH sessions

- [ ] **Enable audit logging**
  - Linux: auditd
  - AWS: CloudTrail
  - GCP: Cloud Logging
  - Track all privileged commands

- [ ] **Use sudo with password for privileged operations**
  ```bash
  # In /etc/sudoers
  Defaults    timestamp_timeout=0
  %admin ALL=(ALL) ALL
  ```

- [ ] **Implement least-privilege principle**
  - Service user can't run sudo
  - Service user can't modify configs
  - Only sysadmins have sudo access

## Network Security

### Firewall Configuration

- [ ] **Enable UFW/iptables firewall**
  ```bash
  ufw enable
  ufw default deny incoming
  ufw default allow outgoing
  ```

- [ ] **Only allow necessary inbound ports**
  - [ ] SSH (22/tcp) - from admin IPs only
  - [ ] Health check (3000/tcp) - from monitoring IPs only
  - [ ] Prometheus metrics (9100/tcp) - from Prometheus IP only
  - [ ] DENY all other incoming

- [ ] **Restrict SSH to admin IPs**
  ```bash
  # Allow SSH only from company VPN
  ufw allow from 10.0.0.0/8 to any port 22 proto tcp

  # Or specific admin IPs
  ufw allow from 1.2.3.4 to any port 22 proto tcp
  ```

- [ ] **Use cloud provider security groups**
  - AWS: Security Groups
  - GCP: Firewall Rules
  - Hetzner: Cloud Firewall
  - Defense in depth (two layers)

- [ ] **Implement DDoS protection**
  - Cloudflare in front of health endpoints
  - AWS Shield / GCP Cloud Armor
  - Rate limiting on endpoints

- [ ] **Enable fail2ban for brute force protection**
  ```bash
  apt-get install fail2ban
  systemctl enable fail2ban
  systemctl start fail2ban
  ```

### RPC Endpoint Security

- [ ] **Use authenticated RPC endpoints**
  - Alchemy, Infura, QuickNode with API keys
  - Not public endpoints (rate limits, reliability)
  - API keys in environment variables, not code

- [ ] **Implement RPC failover**
  - 3+ RPC providers per chain
  - Automatic fallback on failure
  - Monitor failover events

- [ ] **Validate RPC responses**
  - Check for reasonable values
  - Detect MITM attacks
  - Compare multiple sources

- [ ] **Use HTTPS for all RPC calls**
  - Never HTTP (vulnerable to MITM)
  - Verify SSL certificates
  - Pin certificates if possible

- [ ] **Monitor RPC providers**
  - Track uptime and latency
  - Alert on suspicious behavior
  - Rotate providers if unreliable

## Runtime Security

### Service Hardening

- [ ] **Run service as non-root user**
  - Service user: `jeju-oracle`
  - No shell access
  - No sudo permissions

- [ ] **Enable systemd security features**
  ```ini
  [Service]
  NoNewPrivileges=true
  PrivateTmp=true
  ProtectSystem=strict
  ProtectHome=true
  ReadOnlyPaths=/etc /usr
  ReadWritePaths=/var/log/jeju-oracle /tmp
  ```

- [ ] **Set resource limits**
  ```ini
  [Service]
  MemoryMax=512M
  CPUQuota=50%
  LimitNOFILE=65536
  ```

- [ ] **Enable automatic restarts**
  ```ini
  [Service]
  Restart=always
  RestartSec=10
  StartLimitInterval=0
  StartLimitBurst=5
  ```

### Application Security

- [ ] **Validate all environment variables**
  - Check required vars are set
  - Validate format (addresses, URLs)
  - Fail fast if misconfigured

- [ ] **Implement price sanity checks**
  - ETH price: $500-$10,000
  - elizaOS price: $0.000001-$10,000
  - Reject unreasonable values

- [ ] **Limit price deviation per update**
  - Max 50% change (contract enforced)
  - Alert on large moves (>20%)
  - Manual review for extreme volatility

- [ ] **Implement rate limiting**
  - Max 1 update per minute
  - Prevents spam attacks
  - Protects against bugs

- [ ] **Validate transaction success**
  - Wait for confirmations
  - Check receipt status
  - Retry on failure with exponential backoff

- [ ] **Handle errors gracefully**
  - No uncaught exceptions
  - Log all errors
  - Alert on repeated failures

### TEE Attestation (if enabled)

- [ ] **Verify TEE environment**
  - Check /dev/tee exists
  - Validate SGX/TrustZone/etc.
  - Fail if TEE unavailable

- [ ] **Implement attestation validation**
  - Verify Dstack signatures
  - Check attestation freshness
  - Reject invalid attestations

- [ ] **Monitor attestation failures**
  - Alert on multiple failures
  - Automatic fallback to non-TEE mode (if configured)
  - Investigate immediately

- [ ] **Keep TEE firmware updated**
  - Apply security patches
  - Monitor vendor advisories
  - Test updates on testnet first

## Monitoring & Alerting

### Logging

- [ ] **Enable comprehensive logging**
  - All price updates
  - All errors and warnings
  - Leadership changes
  - RPC failovers
  - Authentication attempts

- [ ] **Centralized log aggregation**
  - ELK stack
  - Grafana Loki
  - CloudWatch Logs
  - Splunk

- [ ] **Secure log storage**
  - Encrypted at rest
  - Encrypted in transit
  - Retention: 90+ days
  - Immutable (can't be modified)

- [ ] **Log rotation**
  - Prevent disk full
  - Compress old logs
  - Archive to S3/GCS

- [ ] **Monitor log patterns**
  - Alert on ERROR logs
  - Alert on authentication failures
  - Alert on unusual patterns

### Alerting

- [ ] **Configure critical alerts**
  - All bots down (PagerDuty)
  - Oracle price stale (PagerDuty)
  - Bot compromise indicators (PagerDuty)

- [ ] **Configure warning alerts**
  - High failure rate (Telegram)
  - RPC failover (Telegram)
  - Low wallet balance (Telegram)

- [ ] **Alert delivery channels**
  - PagerDuty for critical (24/7 on-call)
  - Telegram for warnings
  - Discord for info
  - Email for summaries

- [ ] **Test alerts regularly**
  - Simulate failures
  - Verify delivery
  - Check response time

- [ ] **Alert escalation policy**
  - Primary on-call: 5 min response
  - Secondary on-call: 15 min escalation
  - Team lead: 30 min escalation

### Security Monitoring

- [ ] **Monitor for compromise indicators**
  - Unexpected transactions from bot wallet
  - Configuration file modifications
  - New user accounts created
  - Unusual network connections
  - CPU/memory spikes

- [ ] **Set up intrusion detection**
  - OSSEC or Wazuh
  - File integrity monitoring (AIDE)
  - Alert on system changes

- [ ] **Monitor blockchain for attacks**
  - Track oracle contract events
  - Alert on unusual price updates
  - Monitor for front-running

- [ ] **Regular security scans**
  - Vulnerability scanning (Nessus, OpenVAS)
  - Dependency scanning (npm audit, Snyk)
  - Port scanning
  - Weekly automated scans

## Operational Security

### Key Ceremonies

- [ ] **Document key generation process**
  - Who was present
  - Timestamp
  - Entropy source
  - Storage location

- [ ] **Multi-person key generation (for owner key)**
  - 2+ people present
  - Recorded (video/audio)
  - Documented in security log

- [ ] **Secure key backup**
  - Encrypted backup
  - Offline storage
  - Multiple locations
  - Test recovery process

- [ ] **Key rotation procedure**
  - Document steps
  - Test on testnet
  - Schedule maintenance window
  - Notify team

### Change Management

- [ ] **Code review for all changes**
  - 2+ reviewers
  - Security-focused review
  - Test on testnet first

- [ ] **Staged deployments**
  - Deploy to testnet
  - Deploy to one bot
  - Monitor for issues
  - Deploy to remaining bots

- [ ] **Rollback plan**
  - Keep previous version
  - Document rollback steps
  - Test rollback procedure

- [ ] **Change log**
  - What changed
  - Who changed it
  - When
  - Why

### Incident Response

- [ ] **Incident response plan**
  - Detection procedures
  - Containment procedures
  - Eradication procedures
  - Recovery procedures
  - Post-mortem process

- [ ] **Bot compromise response**
  1. Immediately stop compromised bot
  2. Revoke bot's oracle update permission
  3. Investigate how compromise occurred
  4. Generate new key
  5. Redeploy with new key
  6. Post-mortem and lessons learned

- [ ] **Oracle manipulation response**
  1. Pause oracle contract (if owner has permission)
  2. Investigate manipulation
  3. Revert bad price updates (if possible)
  4. Fix vulnerability
  5. Resume operations

- [ ] **DDoS response**
  1. Enable Cloudflare/CloudFlare
  2. Add rate limiting
  3. Block malicious IPs
  4. Scale up infrastructure if needed

- [ ] **Data breach response**
  1. Identify compromised data
  2. Notify affected parties
  3. Regulatory compliance (GDPR, etc.)
  4. Improve security controls

### Regular Security Tasks

- [ ] **Daily**
  - Check alert notifications
  - Review critical logs
  - Verify bots are healthy

- [ ] **Weekly**
  - Review all logs
  - Check for failed login attempts
  - Review cloud account activity
  - Vulnerability scan

- [ ] **Monthly**
  - Review access controls
  - Audit user accounts
  - Test failover procedures
  - Update dependencies
  - Review and update docs

- [ ] **Quarterly**
  - Security assessment
  - Penetration testing (if budget allows)
  - Disaster recovery drill
  - Key rotation (if policy requires)

- [ ] **Annually**
  - Full security audit
  - Update incident response plan
  - Review and update policies
  - Team security training

## Compliance & Best Practices

### General Best Practices

- [ ] **Principle of least privilege**
  - Minimum permissions required
  - Time-limited access when possible
  - Regular access reviews

- [ ] **Defense in depth**
  - Multiple security layers
  - No single point of failure
  - Redundant controls

- [ ] **Secure by default**
  - Deny all, allow specific
  - Fail securely
  - No hardcoded credentials

- [ ] **Security through transparency**
  - Open source (where possible)
  - Security audits public
  - Bug bounty program

### Documentation

- [ ] **Security policies documented**
  - Access control policy
  - Incident response policy
  - Change management policy
  - Data retention policy

- [ ] **Runbooks up to date**
  - Incident response
  - Disaster recovery
  - Key rotation
  - Emergency procedures

- [ ] **Architecture diagrams current**
  - Network topology
  - Data flow
  - Trust boundaries
  - Update quarterly

### Audit Trail

- [ ] **Maintain audit logs**
  - All privileged actions
  - All configuration changes
  - All oracle price updates
  - All security incidents

- [ ] **Regular audits**
  - Internal: Monthly
  - External: Annually
  - Compliance: As required

- [ ] **Security metrics tracked**
  - Mean time to detect (MTTD)
  - Mean time to respond (MTTR)
  - Number of incidents
  - Uptime percentage

## Security Verification

After deployment, verify security posture:

```bash
# Check firewall rules
sudo ufw status verbose

# Verify SSH config
sudo sshd -T | grep -E 'passwordauthentication|pubkeyauthentication|permitrootlogin'

# Check running services
sudo ss -tulpn

# Verify service user permissions
sudo -u jeju-oracle sudo -l  # Should fail

# Check file permissions
ls -la /opt/jeju-oracle/.env  # Should be 600

# Verify systemd hardening
systemctl show jeju-oracle | grep -E 'NoNewPrivileges|PrivateTmp|ProtectSystem'

# Test health endpoint
curl http://localhost:3000/health

# Verify bot can't do admin functions
# (try calling owner-only functions with bot key, should fail)

# Check logs for errors
sudo journalctl -u jeju-oracle -n 100 --no-pager
```

## Security Contacts

- **Security Team**: security@jeju.network
- **Bug Bounty**: [Link to bug bounty program]
- **Incident Response**: [On-call contact]
- **Oracle Owner**: [Multisig or hardware wallet address]

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## Security Checklist Summary

| Category | Items | Priority |
|----------|-------|----------|
| Infrastructure | 7 | High |
| Private Keys | 6 | Critical |
| Access Control | 6 | High |
| Network Security | 10 | High |
| Runtime Security | 13 | High |
| Monitoring | 15 | Medium |
| Operations | 12 | Medium |
| Compliance | 7 | Medium |
| **TOTAL** | **76** | |

**Minimum for Production**: Complete all Critical and High priority items

**Recommended for Enterprise**: Complete all items

---

*Last updated: 2025-01-XX*
*Review and update this checklist quarterly*
