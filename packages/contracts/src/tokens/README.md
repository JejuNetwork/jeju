# Jeju Token Contracts

Canonical, consolidated token contracts for Jeju Network.

## Contracts

### Token.sol

Universal ERC-20 token with trading fees, cross-chain support, and moderation.

**Features:**
- ERC20 with Permit (EIP-2612) for gasless approvals
- EIP-3009 for gasless transfers (meta-transactions)
- Trading fees: creator, holder rewards, treasury, burn (Clanker/Skycloud-style)
- LP fees configurable at creation
- Cross-chain via Hyperlane (lock/unlock on home, burn/mint on synthetic)
- Ban enforcement via moderation system
- Anti-whale: max wallet and transaction limits
- Faucet for testnet

**Fee Structure:**
| Fee Type | Description |
|----------|-------------|
| Creator Fee | % to token creator on each trade |
| Holder Fee | % distributed to holders/stakers |
| Treasury Fee | % to protocol treasury |
| Burn Fee | % burned (deflationary) |
| LP Fee | % on liquidity/bridge operations |

**Usage:**
```solidity
// Deploy with 1B supply, 10B max, as home chain
Token token = new Token(
    "My Token",
    "TOKEN",
    1_000_000_000 * 10**18,  // initial supply
    owner,
    10_000_000_000 * 10**18, // max supply (0 = unlimited)
    true                      // is home chain
);

// Configure fees: 1% creator, 1% holders, 0.5% treasury, 0.5% burn
token.setFees(
    100,                      // creatorFeeBps
    100,                      // holderFeeBps  
    50,                       // treasuryFeeBps
    50,                       // burnFeeBps
    25,                       // lpFeeBps
    creatorWallet,
    holderRewardPool,
    treasury
);

// Anti-whale: 2% max wallet, 1% max transaction
token.setConfig(200, 100, true, false, true);
```

### Presale.sol

Universal presale contract supporting fixed price and CCA (Continuous Clearing Auction).

**Modes:**
1. **Fixed Price**: Traditional presale with set token price
2. **CCA Auction**: Reverse Dutch auction where price decays, all pay clearing price

**Features:**
- Whitelist/early bird phase with bonus
- Volume-based bonuses (1 ETH, 5 ETH, 10 ETH tiers)
- Holder bonuses (existing token holders get multiplier)
- Vesting with TGE unlock, cliff, and linear vesting
- Cross-chain contribution support via Hyperlane
- Refund mechanism for failed presales

**Usage (Fixed Price):**
```solidity
Presale presale = new Presale(tokenAddress, treasury, owner);

presale.configure(
    Presale.PresaleMode.FIXED_PRICE,
    100_000_000 * 10**18,   // 100M tokens
    100 ether,              // soft cap
    1000 ether,             // hard cap
    0.1 ether,              // min contribution
    10 ether,               // max contribution
    0.001 ether,            // price per token
    0, 0, 0,                // CCA params (unused)
    whitelistStart,
    publicStart,
    presaleEnd,
    tgeTimestamp
);

// 20% at TGE, 3 month cliff, 9 month linear vest
presale.setVesting(2000, 90 days, 270 days);

// Bonuses: 10% whitelist, 50% holder, volume bonuses
presale.setBonuses(1000, 5000, 100, 300, 500, existingTokenAddr, 1000 * 10**18);
```

**Usage (CCA Auction):**
```solidity
presale.configure(
    Presale.PresaleMode.CCA_AUCTION,
    100_000_000 * 10**18,
    100 ether, 1000 ether,
    0.1 ether, 10 ether,
    0,                       // token price (unused)
    0.005 ether,            // start price
    0.001 ether,            // reserve price
    1e12,                   // decay per block
    ...
);

// After auction ends, set clearing price
presale.setClearingPrice(0.002 ether, participantAddresses);
```

### EIP3009Token.sol

Lightweight ERC-20 with EIP-3009 gasless transfer support. Use Token.sol for full features.

## Integration

### For New Tokens

```solidity
import {Token} from "@jejunetwork/contracts/tokens/Token.sol";

contract MyToken is Token {
    constructor() Token("My Token", "MTK", 1e27, msg.sender, 0, true) {
        // Configure fees, moderation, cross-chain as needed
    }
}
```

### For Presales

```typescript
const presale = new Presale__factory(signer).deploy(
    tokenAddress,
    treasuryAddress,
    ownerAddress
);

await presale.configure(...);
await presale.setVesting(...);
await token.transfer(presale.address, tokensForSale);
```

### Cross-Chain Setup

```solidity
// On home chain
token.setHyperlane(mailboxAddr, igpAddr, homeChainDomain);
token.setRouter(84532, bytes32(uint256(uint160(baseSepoliaRouter))));

// On synthetic chain
Token syntheticToken = new Token("Token", "TKN", 0, owner, 0, false);
syntheticToken.setHyperlane(mailboxAddr, igpAddr, homeChainDomain);
syntheticToken.setRouter(1, bytes32(uint256(uint160(mainnetRouter))));
```

## Vendor Integration

Vendor tokens (like Babylon) should import the base contracts:

```solidity
// In vendor/babylon/contracts/BabylonToken.sol
import {Token} from "@jejunetwork/contracts/tokens/Token.sol";

contract BabylonToken is Token {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18;
    
    constructor(address owner) Token(
        "Babylon",
        "BBLN", 
        TOTAL_SUPPLY,
        owner,
        TOTAL_SUPPLY, // fixed supply
        true
    ) {
        // BBLN-specific configuration
    }
}
```

## License

MIT
