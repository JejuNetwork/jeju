# Support & Community

Get help, connect with the community, and stay updated on Jeju.

## Quick Help

### 🔍 Search Documentation

Use the search bar (⌘K or Ctrl+K) to find answers quickly.

### 💬 Discord (Fastest)

Join our Discord for real-time support:

**[Join Discord →](https://discord.gg/jeju)**

Channels:
- `#general` - General discussion
- `#dev-support` - Developer questions
- `#testnet-support` - Testnet issues
- `#bridge-support` - Bridge help
- `#announcements` - Important updates

### 📧 Email Support

- **General**: hello@jeju.network
- **Technical**: dev@jeju.network
- **Security**: security@jeju.network
- **Enterprise**: enterprise@jeju.network

Response time: 24-48 hours

## Community

### Discord

**[discord.gg/jeju](https://discord.gg/jeju)**

Active community with 5000+ members:
- Real-time support
- Developer discussions
- Network announcements
- Community events

### Telegram

**[t.me/jejunetwork](https://t.me/jejunetwork)**

Quick updates and casual chat:
- Price discussion
- Network status
- Community polls

### Twitter/X

**[@jejunetwork](https://twitter.com/jejunetwork)**

Follow for:
- Network announcements
- Feature releases
- Ecosystem updates
- Thread guides

### Forum

**[forum.jeju.network](https://forum.jeju.network)**

Long-form discussions:
- Governance proposals
- Technical deep-dives
- Feature requests
- Best practices

### GitHub

**[github.com/elizaos/jeju](https://github.com/elizaos/jeju)**

For developers:
- Source code
- Bug reports
- Feature requests
- Contributions

## Common Issues

### Getting Started

#### "Can't install dependencies"

```bash
# Make sure you're using Bun
bun --version  # Should be 1.0.0+

# Clean install
rm -rf node_modules bun.lock
bun install
```

#### "Docker won't start"

```bash
# macOS: Restart Docker Desktop
# Linux:
sudo systemctl restart docker
```

#### "Kurtosis enclave fails"

```bash
# Clean everything and retry
bun run localnet:reset
kurtosis clean -a
bun run localnet:start
```

### Network Connection

#### "Can't connect to testnet RPC"

Try alternate endpoints:
```bash
# Primary
https://testnet-rpc.jeju.network

# Backup
https://testnet-rpc-backup.jeju.network

# Check status
https://status.jeju.network
```

#### "Transaction stuck/pending"

1. Check on explorer: https://testnet-explorer.jeju.network
2. Verify gas price is sufficient
3. Try increasing gas and resending
4. Ask in Discord if still stuck

#### "Wrong network" error

1. Open MetaMask
2. Switch to Jeju/Jeju Testnet
3. Refresh page
4. Reconnect wallet

### Bridge Issues

#### "Deposit not received"

1. Check transaction on Base explorer
2. Wait 2-5 minutes for finalization
3. Check Jeju explorer for received deposit
4. If >10 minutes, contact support with tx hash

#### "Withdrawal taking too long"

Standard withdrawals take **7 days** for security.

For faster withdrawals:
- Use [Hop Protocol](https://hop.exchange)
- Use [Across](https://across.to)
- Small fee for instant liquidity

#### "Lost funds in bridge"

Bridge transactions are irreversible:
- Funds are never "lost" - they're in smart contracts
- Check both Base and Jeju explorers
- Contact support with transaction hash
- We'll help track down your funds

### Development

#### "Contract deployment fails"

```bash
# Check you have testnet ETH
cast balance YOUR_ADDRESS --rpc-url https://testnet-rpc.jeju.network

# Get testnet ETH
# Visit https://faucet.jeju.network or ask in Discord

# Verify gas price
cast gas-price --rpc-url https://testnet-rpc.jeju.network
```

#### "Contract verification fails"

```bash
# Make sure you're using correct settings
forge verify-contract \
  --chain-id 420690 \
  --compiler-version v0.8.20 \
  --optimizer-runs 200 \
  YOUR_CONTRACT_ADDRESS \
  src/YourContract.sol:YourContract

# If still failing, verify manually on explorer
```

#### "RPC rate limited"

Public RPC has limits (100 req/sec). For production:
- Use [Alchemy](https://alchemy.com) - Higher limits
- Use [QuickNode](https://quicknode.com) - Higher limits
- Run your own node - See [docs](/developers/run-rpc-node)

## Status & Monitoring

### Network Status

**[status.jeju.network](https://status.jeju.network)**

Real-time monitoring:
- ✅ RPC availability
- ✅ Block production
- ✅ Settlement status
- ✅ Bridge status
- ✅ Sequencer health

Subscribe for alerts:
- Email notifications
- SMS alerts
- Webhook integration
- RSS feed

### Known Issues

Current known issues: https://status.jeju.network/issues

### Planned Maintenance

Maintenance windows announced:
- 7 days in advance
- Twitter/Discord announcements
- Email to registered users
- Usually 2-4 AM UTC

## Developer Resources

### Documentation

- **Getting Started**: [/getting-started/introduction](/getting-started/introduction)
- **Developer Guide**: [/developers/quick-start](/developers/quick-start)
- **Contract Addresses**: [/contracts](/contracts)
- **Network Info**: [/network/testnet](/network/testnet)

### Tools

- **Block Explorer**: https://explorer.jeju.network
- **Bridge**: https://bridge.jeju.network
- **Faucet**: https://faucet.jeju.network
- **Status**: https://status.jeju.network

### APIs

- **JSON-RPC**: https://rpc.jeju.network
- **WebSocket**: wss://ws.jeju.network
- **Explorer API**: https://explorer.jeju.network/api
- **GraphQL**: https://graph.jeju.network

### Example Code

Example code and templates available in the main repository:
- Foundry contract templates
- Frontend integration examples
- DeFi protocol integrations

## Enterprise Support

### For Businesses

Building on Jeju for production?

**Contact**: enterprise@jeju.network

We offer:
- Dedicated support channel
- Architecture consultation
- Custom RPC endpoints
- SLA guarantees
- Priority feature requests

### Partnerships

Interested in partnering?

**Contact**: partnerships@jeju.network

Partnership opportunities:
- DeFi protocol integrations
- Wallet integrations
- Indexer support
- Infrastructure providers

## Contributing

### Open Source

Jeju is open source! Contribute on GitHub:

**[github.com/elizaos/jeju](https://github.com/elizaos/jeju)**

Ways to contribute:
- Code contributions
- Documentation improvements
- Bug reports
- Feature requests
- Community support

### Bounties

Check GitHub issues for active bounties and contribution opportunities.

Topics:
- Developer tooling
- Documentation
- Integrations
- Bug fixes

### Content Creation

Create content about Jeju:
- Tutorial videos
- Blog posts
- Integration guides
- Translation

Contact dev@jeju.network for support/sponsorship.

## Bug Bounty Program

### Security Vulnerabilities

**Report on Immunefi**: https://immunefi.com/bounty/jeju

**Bounty Range**:
- Critical: $100,000 - $1,000,000
- High: $10,000 - $100,000
- Medium: $1,000 - $10,000
- Low: $100 - $1,000

**Scope**:
- Core contracts
- Bridge contracts
- Sequencer
- Batcher/Proposer

**Out of Scope**:
- DeFi protocols (report to respective projects)
- Frontend bugs
- Social engineering

### Responsible Disclosure

1. Report to security@jeju.network
2. Include detailed reproduction steps
3. Give us time to fix (90 days)
4. Receive bounty after fix
5. Get credit in security advisories

**Do NOT**:
- Publicly disclose before fix
- Exploit the vulnerability
- Access user data

## Stay Updated

### Newsletter

Subscribe: https://jeju.network/newsletter

Weekly updates on:
- Network developments
- New features
- Ecosystem growth
- Developer spotlights

### Blog

https://blog.jeju.network

Deep dives on:
- Technical architecture
- Economics
- Governance
- Ecosystem projects

### Calendar

https://calendar.jeju.network

Upcoming events:
- Community calls
- Developer workshops
- Hackathons
- Conferences

### RSS Feeds

- Blog: https://blog.jeju.network/rss
- Status: https://status.jeju.network/rss
- GitHub: https://github.com/elizaos/jeju/releases.atom

## FAQs

### General

**Q: What is Jeju?**  
A: A blockchain settling on Base, providing high performance and low costs while maintaining Ethereum security.

**Q: Is Jeju secure?**  
A: Yes. Jeju inherits Ethereum's security through Base's fraud proofs and Ethereum's finality.

### For Users

**Q: How do I get ETH on Jeju?**  
A: Bridge from Base using https://bridge.jeju.network

**Q: How long do withdrawals take?**  
A: 7 days standard, or 15 minutes via fast bridge (small fee).

**Q: Are my funds safe?**  
A: Yes. All contracts are audited and secured by Ethereum.

### For Developers

**Q: Is Jeju EVM-compatible?**  
A: Yes, 100%. All Ethereum tools work.

**Q: Where do I get testnet ETH?**  
A: https://faucet.jeju.network or ask in Discord.

**Q: Can I run a node?**  
A: Yes! See [Running an RPC Node](/developers/run-rpc-node).

## Contact Information

### Support Channels

| Channel | Best For | Response Time |
|---------|----------|---------------|
| Discord | Quick questions, real-time help | Minutes-Hours |
| Email | Detailed issues, official requests | 24-48 hours |
| Forum | Long discussions, proposals | Days |
| Twitter | Updates, quick announcements | N/A |
| GitHub | Bug reports, code issues | Days-Weeks |

### Locations

**Legal Entity**: Jeju Labs, Inc.  
**Jurisdiction**: Cayman Islands  
**Headquarters**: Remote-first

### Social Media

- **Twitter**: [@jejunetwork](https://twitter.com/jejunetwork)
- **Discord**: [discord.gg/jeju](https://discord.gg/jeju)
- **Telegram**: [t.me/jejunetwork](https://t.me/jejunetwork)
- **GitHub**: [github.com/elizaos/jeju](https://github.com/elizaos/jeju)
- **LinkedIn**: [linkedin.com/company/jeju-l3](https://linkedin.com/company/jeju-l3)

---

**Still need help?** Join our [Discord](https://discord.gg/jeju) - we're here to help! 🚀

