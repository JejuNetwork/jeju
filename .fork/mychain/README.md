# MyChain Network

The MyChain L2 network

## Quick Start

### 1. Fund Your Deployer

Send at least 0.5 ETH to your deployer address on Sepolia:

```
0x3695AC575503B162615dA359B2afB26CFE25f2e6
```

### 2. Deploy L1 Contracts

```bash
bun run deploy-l1.ts
```

### 3. Start Your L2 Nodes

```bash
kubectl apply -f k8s/
```

### 4. Deploy L2 Contracts

```bash
bun run deploy-l2.ts
```

### 5. Register with Federation (Optional)

```bash
bun run register-federation.ts
```

## Configuration

### Chain Info
- **Chain ID:** 777777
- **L1:** Sepolia
- **Gas Token:** ETH

### Customization

Edit `branding.json` to customize:
- Network name and tagline
- Colors and logo
- URLs and domains
- Token names

## Files

| File | Description |
|------|-------------|
| `branding.json` | Your network branding |
| `chain.json` | Chain configuration |
| `genesis.json` | Genesis block |
| `federation.json` | Cross-chain settings |
| `keys.json` | Operator keys (KEEP SECURE) |
| `k8s/` | Kubernetes manifests |

## Support

- Documentation: https://docs.mychain.network
- Discord: https://discord.gg/mychain

---

Built with ❤️ using Jeju
