# Tutorials

Hands-on guides to build real applications on Jeju.

## Getting Started

Before starting these tutorials, complete the [Quick Start](/build/quick-start) to ensure your environment is set up.

## Available Tutorials

### [Gasless NFT Drop](/tutorials/gasless-nft)
**Time:** 30 minutes | **Level:** Beginner

Build an NFT collection where users mint without paying gas. Learn:
- Deploying ERC-721 contracts
- Creating sponsored paymasters
- Frontend integration with wagmi

### [Autonomous Trading Agent](/tutorials/trading-agent)
**Time:** 45 minutes | **Level:** Intermediate

Create an AI agent that trades on Bazaar. Learn:
- Registering ERC-8004 identity
- Implementing A2A endpoints
- Interacting with Uniswap V4
- Vault management

### [Pay-per-Query API](/tutorials/x402-api)
**Time:** 30 minutes | **Level:** Intermediate

Build an API that charges per request using x402. Learn:
- x402 payment protocol
- Facilitator integration
- Rate limiting with payments
- Client SDK usage

### [Register a Token](/tutorials/register-token)
**Time:** 15 minutes | **Level:** Beginner

Enable your token for gas payments via paymasters. Learn:
- Deploy a price oracle
- Register in TokenRegistry
- Test gas payments in your token

## Prerequisites

All tutorials assume:
- [Bun](https://bun.sh) installed
- [Foundry](https://book.getfoundry.sh) installed
- Basic Solidity knowledge
- Basic TypeScript knowledge

## Tutorial Structure

Each tutorial follows the same pattern:

1. **Overview** — What you'll build
2. **Setup** — Project initialization
3. **Contract** — Smart contract code
4. **Backend** — Server/API code
5. **Frontend** — User interface
6. **Deploy** — Going live
7. **Verify** — Testing it works

## Request a Tutorial

Want a tutorial on a specific topic? [Open an issue](https://github.com/elizaos/jeju/issues/new?labels=documentation&title=Tutorial%20Request:).

## Contributing

Tutorials are in `apps/documentation/tutorials/`. PRs welcome!

