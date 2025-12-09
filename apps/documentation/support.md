# Support

## Quick Links

| Channel | Use For |
|---------|---------|
| [Discord](https://discord.gg/jeju) | Real-time help |
| [GitHub](https://github.com/elizaos/jeju) | Bug reports, code |
| security@jeju.network | Security issues |

## Common Issues

### Setup

```bash
# Bun not found
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc

# Docker not running
sudo systemctl start docker  # Linux
open -a Docker               # macOS

# Kurtosis enclave fails
kurtosis clean -a && bun run dev
```

### Network

**Can't connect to RPC**: Check https://status.jeju.network

**Transaction stuck**: Increase gas, resend with same nonce

**Need testnet ETH**: 
1. Get Sepolia ETH: https://sepoliafaucet.com
2. Bridge: https://testnet-gateway.jeju.network

### Bridge

**Deposit not received**: Wait 2-5 min, check both explorers

**Withdrawal slow**: Standard = 7 days. Use EIL for fast (~15 min)

## Status

https://status.jeju.network

## Resources

- Explorer: https://explorer.jeju.network
- Gateway: https://gateway.jeju.network
- RPC: https://rpc.jeju.network
