---
layout: home

hero:
  name: Jeju
  text: Fast, Cheap Ethereum L3 Appchain
  tagline: Built by Eliza Labs, maintainers of ElizaOS. OP-Stack settling on Base with sub-second blocks.
  image:
    src: /logo.svg
    alt: Jeju
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/introduction
    - theme: alt
      text: View on GitHub
      link: https://github.com/elizaos/jeju

features:
  - icon: ⚡
    title: 200ms Block Times
    details: Flashblocks technology provides sub-second transaction confirmation.
  
  - icon: 💸
    title: Low Cost L3
    details: L3 architecture settling on Base significantly reduces data availability costs.
  
  - icon: 🔒
    title: Ethereum Security
    details: Inherits security through Base with permissionless fault proofs and challenge windows.
  
  - icon: 📦
    title: EigenDA Integration
    details: Efficient data availability using EigenDA with automatic calldata fallback.
  
  - icon: 🏦
    title: Full DeFi Stack
    details: Pre-deployed Uniswap V4, Synthetix V3, Compound V3, and account abstraction support.
  
  - icon: 🚀
    title: EVM Compatible
    details: Full EVM compatibility. Works with Foundry, Remix, and all EVM tooling.
---

## About Jeju

Jeju is a Layer 3 blockchain built by **Eliza Labs**, the maintainers of ElizaOS. It settles on Base (Layer 2), which settles on Ethereum (Layer 1).

### Architecture
```
Ethereum L1 ← Base ← Jeju
```

### Technical Highlights

- **Flashblocks**: 200ms sub-blocks for instant feedback
- **EigenDA**: Cost-efficient data availability layer
- **Permissionless**: Open node operation and fault proof submission
- **OP-Stack**: Built on proven rollup infrastructure

## Quick Links

<div class="network-grid">
  <div class="info-card">
    <h3>🧪 Testnet</h3>
    <p><strong>Chain ID:</strong> 420690</p>
    <p><strong>RPC:</strong> <code>https://testnet-rpc.jeju.network</code></p>
    <p><strong>Explorer:</strong> <a href="https://testnet-explorer.jeju.network" target="_blank">View →</a></p>
    <p><a href="/network/testnet">Setup Guide →</a></p>
  </div>

  <div class="info-card">
    <h3>🚀 Mainnet</h3>
    <p><strong>Chain ID:</strong> 420691</p>
    <p><strong>RPC:</strong> <code>https://rpc.jeju.network</code></p>
    <p><strong>Explorer:</strong> <a href="https://explorer.jeju.network" target="_blank">View →</a></p>
    <p><a href="/network/mainnet">Setup Guide →</a></p>
  </div>
</div>

## Community & Support

- **Discord**: [Join our community](https://discord.gg/jeju)
- **Twitter**: [@jejunetwork](https://twitter.com/jejunetwork)
- **GitHub**: [github.com/elizaos/jeju](https://github.com/elizaos/jeju)
- **Telegram**: [t.me/jejunetwork](https://t.me/jejunetwork)

## Next Steps

1. [**Quick Start**](/getting-started/quick-start) - Deploy a local network in 10 minutes
2. [**For Developers**](/developers/quick-start) - Build and deploy your first contract
3. [**Deploy Your Chain**](/deployment/overview) - Launch your own Jeju instance

---

<style>
.info-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1.5rem;
}

.info-card h3 {
  margin-top: 0;
}

.info-card code {
  font-size: 0.85em;
  word-break: break-all;
}

.network-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
  margin: 2rem 0;
}
</style>

