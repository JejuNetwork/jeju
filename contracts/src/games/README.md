# Jeju Games Contracts

This directory contains standardized game token systems and on-chain game implementations built on Jeju.

## Standardized Game Token System

Reusable contracts for any game on Jeju that needs in-game economies. These are reference implementations that games can use as-is or customize.

### 🔑 Critical Concept: Two-State Item System

Hyperscape uses a **dual-state system** for items:

**1. IN-GAME ITEMS (MUD Tables)**
- Stored in `InventorySlot` and `ItemInstance` tables
- Temporary - can be dropped on death
- Only tradeable within game mechanics
- Exists purely in game state

**2. MINTED NFT ITEMS (ERC-1155)**
- Permanent on-chain tokens
- **NEVER drop on death** (protected)
- Tradeable outside game (marketplaces, escrow)
- Original minter tracked forever
- Can be converted back to in-game state

**Key Integration:** The `ItemInstance` MUD table has an `isMinted` flag:
- `false` = Normal in-game item (droppable)
- `true` = Minted NFT (protected, permanent)

See `HYPERSCAPE_INTEGRATION.md` for complete integration details.

### `Gold.sol` - In-Game Currency (ERC-20)
Standard ERC-20 token with signature-based claiming:
- Players earn gold in-game (mob kills, quests, selling items)
- Game server signs claim requests `(player, amount, nonce)`
- Players call `claimGold()` with signature to mint tokens
- Burnable for in-game purchases
- Tradeable on marketplace (Bazaar)
- No special treatment - equal to other tokens

**Key Features:**
- Signature-based minting (only game server can authorize)
- Nonce prevents replay attacks
- Unlimited supply (economy determines scarcity)
- Integrates with PlayerTradeEscrow for P2P trading

**Example Usage:**
```solidity
// Deploy
Gold gold = new Gold(gameServerSigner, owner);

// Player claims gold (with server signature)
gold.claimGold(1000 * 10**18, nonce, signature);

// Burn for in-game purchase
gold.burn(500 * 10**18);
```

### `Items.sol` - Mintable Item Tokens (ERC-1155)
ERC-1155 multi-token standard supporting both stackable and unique items:
- Players obtain items in-game (stored in game state/MUD tables)
- Players "mint" items to make them permanent tokens
- Game server signs mint requests with metadata
- Each non-stackable instance has unique `instanceId` to prevent double-minting
- Burnable to convert back to in-game items

**Item Types:**
- **Stackable items** (fungible): arrows, potions, resources (quantity > 1)
- **Unique items** (non-fungible): legendary weapons, armor (quantity = 1)

**Metadata:**
- `itemId`: Numeric item type identifier
- `stackable`: Whether item can stack (true/false)
- `attack`, `defense`, `strength`: Combat stats
- `rarity`: 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
- `name`: Human-readable item name

**Integration Flow:**
1. Player gets item in-game → stored in game state
2. Player decides to mint → makes it permanent & tradeable
3. Game server signs metadata
4. Player calls `mintItem()` → creates NFT
5. Trade on Bazaar or PlayerTradeEscrow

**Example Usage:**
```solidity
// Deploy
Items items = new Items(gameServerSigner, owner);

// Create item types (owner only)
uint256 arrowsId = items.createItemType("Bronze Arrows", true, 5, 0, 0, 0); // stackable
uint256 swordId = items.createItemType("Legendary Sword", false, 50, 0, 10, 4); // unique

// Mint stackable items (with server signature)
items.mintItem(
    arrowsId,            // item type ID
    100,                 // amount (stackable)
    instanceId,          // instance hash
    signature
);

// Mint unique item (with server signature)
items.mintItem(
    swordId,             // item type ID
    1,                   // amount (must be 1 for non-stackable)
    uniqueInstanceId,    // unique instance hash
    signature
);
```

### ✅ Simplified: Uses Existing IdentityRegistry (ERC-8004)

**No separate registry needed!** Games register in the existing IdentityRegistry:

```solidity
// Step 1: Register game as agent in IdentityRegistry
uint256 gameAgentId = identityRegistry.register("ipfs://hyperscape-metadata");

// Step 2: Set game metadata
identityRegistry.setMetadata(gameAgentId, "type", bytes("game"));
identityRegistry.setMetadata(gameAgentId, "name", bytes("Hyperscape"));
identityRegistry.setMetadata(gameAgentId, "category", bytes("mmo-rpg"));

// Step 3: Deploy game contracts linked to agentId
Gold gold = new Gold(gameAgentId, gameSigner, owner);
Items items = new Items(gameAgentId, gameSigner, owner);

// Game is now discoverable via IdentityRegistry!
// Query: identityRegistry.getMetadata(gameAgentId, "type") → "game"
```

**Benefits:**
- ✅ Leverages existing ERC-8004 infrastructure
- ✅ Games discoverable alongside agents/services
- ✅ Uses existing reputation/validation system
- ✅ No duplicate registry contracts
- ✅ Metadata system already built
- ✅ Tag-based discovery (`["game", "mmo", "rpg"]`)

### `PlayerTradeEscrow.sol` - P2P Trading
Secure atomic trades between players:
- Supports ERC-20 (Gold), ERC-721, and ERC-1155 (Items)
- Multi-asset trades (mix different token types)
- Both players must deposit and confirm
- Either player can cancel before both confirm
- Minimum review period (1 minute)
- Trade expiration (7 days)

**Trade Flow:**
1. Player A creates trade with Player B
2. Both deposit their offered assets
3. Both review and confirm
4. Trade executes atomically (all or nothing)

**Example Usage:**
```solidity
// Create trade
uint256 tradeId = escrow.createTrade(playerB);

// Deposit items
TradeItem[] memory myItems = new TradeItem[](3);
myItems[0] = TradeItem(address(gold), 0, 1000 * 10**18, TokenType.ERC20);     // 1000 Gold
myItems[1] = TradeItem(address(items), arrowsId, 100, TokenType.ERC1155);     // 100 arrows (stackable)
myItems[2] = TradeItem(address(items), swordId, 1, TokenType.ERC1155);        // 1 sword (unique)
escrow.depositItems(tradeId, myItems);

// Confirm after both deposit
escrow.confirmTrade(tradeId);
// Trade executes automatically when both confirm
```

---

## TEE Architecture Overview

Games run inside Trusted Execution Environments (TEE) for provably fair outcomes:
- Game logic executes in isolated TEE container
- TEE generates attestation proof of execution
- Smart contracts verify attestation before accepting results
- Grace period prevents MEV attacks on result publication

## Structure

### `/mmo/` - MMO Game Framework (Hyperscape)
Full on-chain MMO implementation using MUD (Autonomous Worlds framework):

**Hyperscape** - On-chain RuneScape-style RPG
- **Location**: `mmo/` (formerly `hyperscape/`)
- **Framework**: MUD v2 (Lattice)
- **Features**:
  - 9 Skills (Combat: Attack, Strength, Defense, Constitution, Ranged | Gathering: Woodcutting, Fishing, Firemaking, Cooking)
  - 28-slot inventory system
  - 6-slot equipment system (weapon, shield, helmet, body, legs, arrows)
  - Combat system with mobs and loot tables
  - Resource gathering (trees, fishing spots)
  - On-chain state storage using MUD tables

**Systems** (`mmo/src/systems/`):
- `PlayerSystem.sol` - Registration, movement, health
- `CombatSystem.sol` - Combat mechanics, damage calculation
- `EquipmentSystem.sol` - Equip/unequip items
- `InventorySystem.sol` - 28-slot inventory management
- `MobSystem.sol` - Mob spawning and respawning
- `ResourceSystem.sol` - Woodcutting, fishing, firemaking
- `SkillSystem.sol` - XP and leveling for 9 skills
- `AdminSystem.sol` - World initialization and configuration

**Libraries** (`mmo/src/libraries/`):
- `CombatLib.sol` - Damage calculations, hit rolls
- `ItemLib.sol` - Equipment slot detection, requirements
- `XPLib.sol` - RuneScape XP table and level calculations

**Tables** (`mmo/src/codegen/tables/`) - Auto-generated by MUD:
- Player, Position, Health, CombatSkills, GatheringSkills
- Equipment, InventorySlot, ItemMetadata
- Mob, MobLootTable, Resource
- Coins, CombatTarget, WorldConfig

### `/Contest.sol` - TEE-Based Contest Oracle

Generic oracle for TEE-based contests (races, tournaments, etc):

**Architecture**:
1. **PENDING**: TEE service announces contest with options
2. **ACTIVE**: Trading opens on prediction markets
3. **GRACE_PERIOD**: Trading frozen (prevents MEV sandwich attacks)
4. **FINISHED**: TEE publishes results with attestation

**TEE Attestation**:
- Container hash (SHA256 of TEE image)
- Attestation quote (SGX/SEV-SNP proof)
- Signature over results
- Timestamp

**Security Features**:
- Only approved container hashes accepted
- Grace period prevents front-running
- Attestation proves results came from trusted TEE
- No on-chain random number generation needed

**Example: eHorse Racing**
```solidity
// 1. TEE announces contest
contest.announceContest(["Thunder", "Lightning", "Storm", "Blaze"], startTime, SINGLE_WINNER);

// 2. Trading happens (60s)
// Users bet on prediction markets

// 3. Grace period (30s)
contest.startGracePeriod(contestId);
// Trading frozen, prevents MEV

// 4. TEE publishes results
contest.publishResults(contestId, winnerIdx, containerHash, attestation, sig);
```

### Game Token Deployment

The standardized game token contracts (`Gold.sol`, `Items.sol`, `GameItemRegistry.sol`, `PlayerTradeEscrow.sol`) are located in this directory (`/contracts/src/games/`).

For game-specific implementations:
- Use these contracts as reference implementations
- Customize token names, symbols, and metadata as needed
- Deploy with your game server's signer address
- See `/scripts/deploy-rpg-game.ts` for deployment examples

## Building MMO Contracts

```bash
cd contracts/src/games/mmo
bun install
bun run build  # Generates MUD codegen
```

## Testing

MUD-based tests run separately from Foundry:
```bash
cd contracts/src/games/mmo
bun run test
```

## Deployment

Deploy the MMO World contract:
```bash
cd contracts/src/games/mmo  
bun run deploy:local  # For localnet
```

For full Hyperscape deployment with tokens:
```bash
cd /Users/shawwalters/jeju
bun scripts/deploy-rpg-game.ts
```

## Architecture

The MMO framework uses MUD's autonomous worlds pattern:
1. **World Contract** - Central registry and dispatcher
2. **Systems** - Game logic (combat, inventory, skills)
3. **Tables** - On-chain state storage
4. **Libraries** - Shared game mechanics

All game state is stored on-chain in MUD tables. Clients read from the chain and submit transactions to update state.

## Why MUD?

- **Deterministic**: All game logic runs on-chain
- **Composable**: Other contracts can read/write game state
- **Indexable**: Automatic GraphQL indexer for game state
- **Autonomous**: Game continues running without servers
- **Moddable**: Anyone can build on top

## Future Games

Additional MMO games can be added to this directory following the same MUD pattern. Each game gets its own namespace and isolated state.

## License

MIT - Build your own on-chain MMO!


