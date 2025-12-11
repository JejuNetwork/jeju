/**
 * Game Tokens Processor - Indexes Gold.sol and Items.sol events
 * 
 * Events indexed:
 * - GoldClaimed: Player claimed gold with game server signature
 * - GoldBurned: Player burned gold for in-game purchase
 * - ItemMinted: Player minted item NFT with game server signature
 * - ItemBurned: Player burned item NFT back to in-game
 * - ItemTypeCreated: New item type created by game owner
 * - NFTProvenance: Provenance tracking for minted items
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import {
    TokenTransfer,
    TokenBalance,
    Account,
    Contract,
} from './model';
import { TokenStandard } from './model/generated/_tokenStandard';

// Event signatures
const GOLD_CLAIMED = ethers.id('GoldClaimed(address,uint256,uint256)');
const GOLD_BURNED = ethers.id('GoldBurned(address,uint256)');
const ITEM_MINTED = ethers.id('ItemMinted(address,uint256,uint256,bytes32,bool,uint8)');
const ITEM_BURNED = ethers.id('ItemBurned(address,uint256,uint256)');
const ITEM_TYPE_CREATED = ethers.id('ItemTypeCreated(uint256,string,bool,uint8)');
const NFT_PROVENANCE = ethers.id('NFTProvenance(address,uint256,bytes32,uint256)');
const GAME_SIGNER_UPDATED = ethers.id('GameSignerUpdated(address,address)');

// ERC-1155 standard events (for tracking transfers)
const TRANSFER_SINGLE = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
const TRANSFER_BATCH = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');

// ABIs for decoding
const goldInterface = new ethers.Interface([
    'event GoldClaimed(address indexed player, uint256 amount, uint256 nonce)',
    'event GoldBurned(address indexed player, uint256 amount)',
    'event GameSignerUpdated(address indexed oldSigner, address indexed newSigner)',
]);

const itemsInterface = new ethers.Interface([
    'event ItemMinted(address indexed minter, uint256 indexed itemId, uint256 amount, bytes32 instanceId, bool stackable, uint8 rarity)',
    'event ItemBurned(address indexed player, uint256 indexed itemId, uint256 amount)',
    'event ItemTypeCreated(uint256 indexed itemId, string name, bool stackable, uint8 rarity)',
    'event NFTProvenance(address indexed originalMinter, uint256 indexed itemId, bytes32 indexed instanceId, uint256 mintedAt)',
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
    'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface MintedItem {
    minter: string;
    itemId: bigint;
    amount: bigint;
    instanceId: string;
    stackable: boolean;
    rarity: number;
    timestamp: Date;
    txHash: string;
    blockNumber: number;
}

interface GoldClaim {
    player: string;
    amount: bigint;
    nonce: bigint;
    timestamp: Date;
    txHash: string;
    blockNumber: number;
}

export async function processGameTokenEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const accounts = new Map<string, Account>();
    const tokenTransfers: TokenTransfer[] = [];
    const tokenBalances = new Map<string, TokenBalance>();
    const contracts = new Map<string, Contract>();
    
    // Track minted items and gold claims for stats
    const mintedItems: MintedItem[] = [];
    const goldClaims: GoldClaim[] = [];

    function getOrCreateAccount(address: string, blockNumber: number, timestamp: Date): Account {
        const id = address.toLowerCase();
        let account = accounts.get(id);
        if (!account) {
            account = new Account({
                id,
                address: id,
                isContract: false,
                firstSeenBlock: blockNumber,
                lastSeenBlock: blockNumber,
                transactionCount: 0,
                totalValueSent: 0n,
                totalValueReceived: 0n,
                labels: [],
                firstSeenAt: timestamp,
                lastSeenAt: timestamp
            });
            accounts.set(id, account);
        }
        account.lastSeenBlock = blockNumber;
        account.lastSeenAt = timestamp;
        return account;
    }

    function getOrCreateContract(address: string, blockNumber: number, timestamp: Date): Contract {
        const id = address.toLowerCase();
        let contract = contracts.get(id);
        if (!contract) {
            contract = new Contract({
                id,
                address: id,
                isERC20: false,
                isERC721: false,
                isERC1155: false,
                isProxy: false,
                verified: false,
                firstSeenAt: timestamp,
                lastSeenAt: timestamp
            });
            contracts.set(id, contract);
        }
        return contract;
    }

    for (const block of ctx.blocks) {
        const blockTimestamp = new Date(block.header.timestamp);
        
        for (const log of block.logs) {
            const eventSig = log.topics[0];
            if (!log.transaction) continue;
            const txHash = log.transaction.hash;
            const contractAddress = log.address.toLowerCase();

            // ============ Gold.sol Events ============

            if (eventSig === GOLD_CLAIMED) {
                const decoded = goldInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const player = decoded.args.player.toLowerCase();
                const amount = BigInt(decoded.args.amount.toString());
                const nonce = BigInt(decoded.args.nonce.toString());

                const playerAccount = getOrCreateAccount(player, block.header.height, blockTimestamp);
                const tokenContract = getOrCreateContract(contractAddress, block.header.height, blockTimestamp);
                tokenContract.isERC20 = true;
                tokenContract.contractType = 'GAME';

                // Track as token transfer (mint from zero address)
                tokenTransfers.push(new TokenTransfer({
                    id: `${txHash}-${log.logIndex}`,
                    logIndex: log.logIndex,
                    tokenStandard: TokenStandard.ERC20,
                    from: getOrCreateAccount(ZERO_ADDRESS, block.header.height, blockTimestamp),
                    to: playerAccount,
                    token: tokenContract,
                    value: amount,
                    block: { id: block.header.hash } as never,
                    transaction: { id: txHash } as never,
                    timestamp: blockTimestamp
                }));

                goldClaims.push({
                    player,
                    amount,
                    nonce,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                });

                ctx.log.info(`Gold claimed: ${player} claimed ${ethers.formatEther(amount)} gold (nonce: ${nonce})`);
            }
            else if (eventSig === GOLD_BURNED) {
                const decoded = goldInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const player = decoded.args.player.toLowerCase();
                const amount = BigInt(decoded.args.amount.toString());

                const playerAccount = getOrCreateAccount(player, block.header.height, blockTimestamp);
                const tokenContract = getOrCreateContract(contractAddress, block.header.height, blockTimestamp);
                tokenContract.isERC20 = true;

                // Track as token transfer (burn to zero address)
                tokenTransfers.push(new TokenTransfer({
                    id: `${txHash}-${log.logIndex}`,
                    logIndex: log.logIndex,
                    tokenStandard: TokenStandard.ERC20,
                    from: playerAccount,
                    to: getOrCreateAccount(ZERO_ADDRESS, block.header.height, blockTimestamp),
                    token: tokenContract,
                    value: amount,
                    block: { id: block.header.hash } as never,
                    transaction: { id: txHash } as never,
                    timestamp: blockTimestamp
                }));

                ctx.log.info(`Gold burned: ${player} burned ${ethers.formatEther(amount)} gold`);
            }

            // ============ Items.sol Events ============

            else if (eventSig === ITEM_MINTED) {
                const decoded = itemsInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const minter = decoded.args.minter.toLowerCase();
                const itemId = BigInt(decoded.args.itemId.toString());
                const amount = BigInt(decoded.args.amount.toString());
                const instanceId = decoded.args.instanceId;
                const stackable = decoded.args.stackable;
                const rarity = decoded.args.rarity;

                const minterAccount = getOrCreateAccount(minter, block.header.height, blockTimestamp);
                const tokenContract = getOrCreateContract(contractAddress, block.header.height, blockTimestamp);
                tokenContract.isERC1155 = true;
                tokenContract.contractType = 'GAME';

                // Track as ERC-1155 transfer (mint from zero address)
                tokenTransfers.push(new TokenTransfer({
                    id: `${txHash}-${log.logIndex}`,
                    logIndex: log.logIndex,
                    tokenStandard: TokenStandard.ERC1155,
                    from: getOrCreateAccount(ZERO_ADDRESS, block.header.height, blockTimestamp),
                    to: minterAccount,
                    token: tokenContract,
                    value: amount,
                    tokenId: itemId.toString(),
                    block: { id: block.header.hash } as never,
                    transaction: { id: txHash } as never,
                    timestamp: blockTimestamp
                }));

                mintedItems.push({
                    minter,
                    itemId,
                    amount,
                    instanceId,
                    stackable,
                    rarity,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                });

                const rarityNames = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
                ctx.log.info(`Item minted: ${minter} minted ${amount}x item #${itemId} (${rarityNames[rarity] || 'Unknown'}, ${stackable ? 'stackable' : 'unique'})`);
            }
            else if (eventSig === ITEM_BURNED) {
                const decoded = itemsInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const player = decoded.args.player.toLowerCase();
                const itemId = BigInt(decoded.args.itemId.toString());
                const amount = BigInt(decoded.args.amount.toString());

                const playerAccount = getOrCreateAccount(player, block.header.height, blockTimestamp);
                const tokenContract = getOrCreateContract(contractAddress, block.header.height, blockTimestamp);
                tokenContract.isERC1155 = true;

                // Track as ERC-1155 transfer (burn to zero address)
                tokenTransfers.push(new TokenTransfer({
                    id: `${txHash}-${log.logIndex}`,
                    logIndex: log.logIndex,
                    tokenStandard: TokenStandard.ERC1155,
                    from: playerAccount,
                    to: getOrCreateAccount(ZERO_ADDRESS, block.header.height, blockTimestamp),
                    token: tokenContract,
                    value: amount,
                    tokenId: itemId.toString(),
                    block: { id: block.header.hash } as never,
                    transaction: { id: txHash } as never,
                    timestamp: blockTimestamp
                }));

                ctx.log.info(`Item burned: ${player} burned ${amount}x item #${itemId}`);
            }
            else if (eventSig === ITEM_TYPE_CREATED) {
                const decoded = itemsInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const itemId = BigInt(decoded.args.itemId.toString());
                const name = decoded.args.name;
                const stackable = decoded.args.stackable;
                const rarity = decoded.args.rarity;

                ctx.log.info(`Item type created: #${itemId} "${name}" (${stackable ? 'stackable' : 'unique'}, rarity: ${rarity})`);
            }
            else if (eventSig === NFT_PROVENANCE) {
                const decoded = itemsInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const originalMinter = decoded.args.originalMinter.toLowerCase();
                const itemId = BigInt(decoded.args.itemId.toString());
                const instanceId = decoded.args.instanceId;
                const mintedAt = BigInt(decoded.args.mintedAt.toString());

                ctx.log.info(`NFT Provenance: item #${itemId} originally minted by ${originalMinter} at ${mintedAt}`);
            }

            // ============ ERC-1155 Transfer Events ============

            else if (eventSig === TRANSFER_SINGLE) {
                const decoded = itemsInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const from = decoded.args.from.toLowerCase();
                const to = decoded.args.to.toLowerCase();
                const id = BigInt(decoded.args.id.toString());
                const value = BigInt(decoded.args.value.toString());

                // Skip mint/burn events (already handled above)
                if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue;

                const fromAccount = getOrCreateAccount(from, block.header.height, blockTimestamp);
                const toAccount = getOrCreateAccount(to, block.header.height, blockTimestamp);
                const tokenContract = getOrCreateContract(contractAddress, block.header.height, blockTimestamp);
                tokenContract.isERC1155 = true;

                tokenTransfers.push(new TokenTransfer({
                    id: `${txHash}-${log.logIndex}`,
                    logIndex: log.logIndex,
                    tokenStandard: TokenStandard.ERC1155,
                    from: fromAccount,
                    to: toAccount,
                    token: tokenContract,
                    value,
                    tokenId: id.toString(),
                    block: { id: block.header.hash } as never,
                    transaction: { id: txHash } as never,
                    timestamp: blockTimestamp
                }));
            }
        }
    }

    // Persist all entities
    await ctx.store.upsert(Array.from(accounts.values()));
    await ctx.store.upsert(Array.from(contracts.values()));
    await ctx.store.insert(tokenTransfers);

    // Log stats
    if (goldClaims.length > 0) {
        ctx.log.info(`Processed ${goldClaims.length} gold claims`);
    }
    if (mintedItems.length > 0) {
        ctx.log.info(`Processed ${mintedItems.length} item mints`);
    }
}
