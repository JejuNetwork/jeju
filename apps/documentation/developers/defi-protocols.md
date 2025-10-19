# DeFi Protocols on Jeju

Guide to integrating with DeFi protocols deployed on Jeju.

## Available Protocols

### Uniswap V4

Next-generation AMM with custom hooks.

**Status**: Coming soon  
**Documentation**: [Uniswap V4 Docs](https://docs.uniswap.org/contracts/v4/overview)

### Synthetix V3

Decentralized perpetuals and synthetic assets.

**Status**: Coming soon  
**Documentation**: [Synthetix V3 Docs](https://docs.synthetix.io/v/v3/)

### Compound V3

Efficient lending and borrowing.

**Status**: Coming soon  
**Documentation**: [Compound V3 Docs](https://docs.compound.finance/)

## Integration Guide

### Using Liquidity Paymaster

The liquidity paymaster enables gasless transactions paid in elizaOS tokens.

```solidity
// Your contract
contract MyDeFiApp {
    address public revenueWallet;
    
    function swap(...) external {
        // Your logic here
        // Revenue automatically credited to revenueWallet
        // when users pay gas with elizaOS via paymaster
    }
}
```

See [Contract Addresses](/contracts) for deployed protocol addresses.

## Resources

- [Quick Start](./quick-start.md)
- [Deploy Contracts](./deploy-contracts.md)
- [Contract Addresses](/contracts)


