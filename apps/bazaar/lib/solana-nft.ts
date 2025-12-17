/**
 * Solana NFT Cross-Chain Integration
 * Enables viewing and bridging NFTs between EVM and Solana
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { Address } from 'viem';
import { SOLANA_RPC_URL } from '@/config';

const METAPLEX_TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface SolanaNFT {
  mint: string;
  owner: string;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  creators: SolanaCreator[];
  collection?: {
    verified: boolean;
    key: string;
  };
}

interface SolanaCreator {
  address: string;
  verified: boolean;
  share: number;
}

export interface CrossChainNFTListing {
  id: string;
  sourceChain: 'evm' | 'solana';
  sourceChainId: number;
  // EVM fields
  evmContract?: Address;
  evmTokenId?: bigint;
  // Solana fields
  solanaMint?: string;
  // Common
  name: string;
  description?: string;
  imageUri: string;
  owner: string;
  price?: bigint;
  currency?: string;
}

function getMetadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METAPLEX_TOKEN_METADATA_PROGRAM.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_TOKEN_METADATA_PROGRAM
  );
}

export class SolanaNFTClient {
  private connection: Connection;

  constructor(rpcUrl: string = SOLANA_RPC_URL) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async getNFTsByOwner(ownerPubkey: string): Promise<SolanaNFT[]> {
    const owner = new PublicKey(ownerPubkey);

    // Get all token accounts owned by this wallet
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const nfts: SolanaNFT[] = [];

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed.info;
      
      // NFTs have amount = 1 and decimals = 0
      if (parsed.tokenAmount.amount === '1' && parsed.tokenAmount.decimals === 0) {
        const mint = new PublicKey(parsed.mint);
        const metadata = await this.getMetadata(mint);
        
        if (metadata) {
          nfts.push(metadata);
        }
      }
    }

    return nfts;
  }

  async getMetadata(mint: PublicKey): Promise<SolanaNFT | null> {
    const [metadataPda] = getMetadataPda(mint);
    const accountInfo = await this.connection.getAccountInfo(metadataPda);
    
    if (!accountInfo) return null;

    const data = accountInfo.data;
    
    // Parse Metaplex metadata account
    // Key (1) + UpdateAuthority (32) + Mint (32) + Name (36) + Symbol (14) + Uri (204) + ...
    let offset = 1; // Skip key byte

    offset += 32; // Skip update authority
    offset += 32; // Skip mint (we already have it)

    // Name (4-byte length prefix + string)
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0/g, '');
    offset += 32; // Fixed size for name

    // Symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.slice(offset, offset + symbolLen).toString('utf8').replace(/\0/g, '');
    offset += 10; // Fixed size for symbol

    // URI
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '');
    offset += 200; // Fixed size for URI

    // Seller fee basis points
    const sellerFeeBasisPoints = data.readUInt16LE(offset);
    offset += 2;

    // Creators (optional - has_creators flag)
    const creators: SolanaCreator[] = [];
    const hasCreators = data.readUInt8(offset) === 1;
    offset += 1;

    if (hasCreators) {
      const creatorsLen = data.readUInt32LE(offset);
      offset += 4;

      for (let i = 0; i < creatorsLen; i++) {
        const address = new PublicKey(data.slice(offset, offset + 32)).toBase58();
        offset += 32;
        const verified = data.readUInt8(offset) === 1;
        offset += 1;
        const share = data.readUInt8(offset);
        offset += 1;

        creators.push({ address, verified, share });
      }
    }

    // Collection (optional)
    let collection: { verified: boolean; key: string } | undefined;
    // Skip to collection if present (complex parsing, simplified here)

    // Get token owner
    const largestAccounts = await this.connection.getTokenLargestAccounts(mint);
    let ownerAddress = '';
    
    if (largestAccounts.value.length > 0) {
      const tokenAccount = largestAccounts.value[0].address;
      const accountInfo = await this.connection.getParsedAccountInfo(tokenAccount);
      if (accountInfo.value && 'parsed' in accountInfo.value.data) {
        ownerAddress = accountInfo.value.data.parsed.info.owner;
      }
    }

    return {
      mint: mint.toBase58(),
      owner: ownerAddress,
      name,
      symbol,
      uri,
      sellerFeeBasisPoints,
      creators,
      collection,
    };
  }

  async getNFTMetadataJson(uri: string): Promise<NFTMetadataJson | null> {
    // Handle IPFS URIs
    let fetchUrl = uri;
    if (uri.startsWith('ipfs://')) {
      fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    const response = await fetch(fetchUrl);
    if (!response.ok) return null;

    return response.json();
  }
}

interface NFTMetadataJson {
  name: string;
  symbol?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  properties?: {
    files?: Array<{ uri: string; type: string }>;
    category?: string;
    creators?: Array<{ address: string; share: number }>;
  };
}

export function createSolanaNFTClient(rpcUrl?: string): SolanaNFTClient {
  return new SolanaNFTClient(rpcUrl);
}

/**
 * Convert Solana NFT to unified CrossChainNFTListing format
 */
export async function solanaNftToListing(
  nft: SolanaNFT,
  client: SolanaNFTClient
): Promise<CrossChainNFTListing> {
  const metadata = await client.getNFTMetadataJson(nft.uri);

  return {
    id: `solana:${nft.mint}`,
    sourceChain: 'solana',
    sourceChainId: 101,
    solanaMint: nft.mint,
    name: nft.name || metadata?.name || 'Unknown',
    description: metadata?.description,
    imageUri: metadata?.image || '',
    owner: nft.owner,
  };
}

/**
 * Get all NFTs from a user across both EVM and Solana
 */
export async function getCrossChainNFTs(
  evmAddress?: Address,
  solanaPubkey?: string,
  solanaClient?: SolanaNFTClient
): Promise<CrossChainNFTListing[]> {
  const listings: CrossChainNFTListing[] = [];

  // Get Solana NFTs
  if (solanaPubkey && solanaClient) {
    const solanaNfts = await solanaClient.getNFTsByOwner(solanaPubkey);
    
    for (const nft of solanaNfts) {
      const listing = await solanaNftToListing(nft, solanaClient);
      listings.push(listing);
    }
  }

  // EVM NFTs would be fetched via existing indexer/subgraph
  // This is handled by existing Bazaar infrastructure

  return listings;
}

/**
 * Check if an NFT can be bridged cross-chain
 * (Currently only select collections are supported)
 */
export function canBridgeNFT(listing: CrossChainNFTListing): boolean {
  // Bridging NFTs requires:
  // 1. Supported collection on both chains
  // 2. User ownership verification
  // 3. Bridge contract deployment for that collection
  
  // For now, return false - this requires additional infrastructure
  // to support cross-chain NFT bridging via ZKSolBridge
  return false;
}

/**
 * Get estimated bridge cost for an NFT
 */
export function estimateNFTBridgeCost(
  sourceChain: 'evm' | 'solana',
  destChain: 'evm' | 'solana'
): { fee: string; estimatedTime: number } {
  if (sourceChain === destChain) {
    return { fee: '0', estimatedTime: 0 };
  }

  // Cross-chain NFT bridging is more expensive due to:
  // - ZK proof generation for ownership
  // - Metadata verification
  // - Destination chain minting
  return {
    fee: '0.005', // ~0.005 ETH / ~0.1 SOL
    estimatedTime: 600, // ~10 minutes for ZK proof + confirmation
  };
}

