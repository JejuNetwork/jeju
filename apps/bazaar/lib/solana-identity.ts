/**
 * Solana Identity Client - Integrates with 8004-solana program
 * Enables cross-chain identity verification and discovery
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import type { Address } from 'viem';

const AGENT_REGISTRY_PROGRAM_ID = new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp');

export interface SolanaAgent {
  agentId: bigint;
  owner: string;
  asset: string;
  agentUri: string;
  nftName: string;
  nftSymbol: string;
  createdAt: number;
}

export interface SolanaReputation {
  agentId: bigint;
  totalFeedbacks: bigint;
  averageScore: number;
  lastUpdated: number;
}

export interface SolanaFeedback {
  agentId: bigint;
  feedbackIndex: bigint;
  clientAddress: string;
  score: number;
  fileHash: Uint8Array;
  isRevoked: boolean;
  createdAt: number;
}

export interface CrossChainIdentity {
  evmAgentId: bigint | null;
  evmChainId: number | null;
  evmAddress: Address | null;
  solanaAgentId: bigint | null;
  solanaPubkey: string | null;
  federatedId: string | null;
  reputation: number;
}

function getRegistryConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('registry_config')],
    AGENT_REGISTRY_PROGRAM_ID
  );
}

function getAgentPda(agentId: bigint): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), idBuffer],
    AGENT_REGISTRY_PROGRAM_ID
  );
}

function getReputationPda(agentId: bigint): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_reputation'), idBuffer],
    AGENT_REGISTRY_PROGRAM_ID
  );
}

function getFeedbackPda(agentId: bigint, feedbackIndex: bigint): [PublicKey, number] {
  const agentIdBuffer = Buffer.alloc(8);
  agentIdBuffer.writeBigUInt64LE(agentId);
  const feedbackIndexBuffer = Buffer.alloc(8);
  feedbackIndexBuffer.writeBigUInt64LE(feedbackIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('feedback'), agentIdBuffer, feedbackIndexBuffer],
    AGENT_REGISTRY_PROGRAM_ID
  );
}

export class SolanaIdentityClient {
  private connection: Connection;
  private programId: PublicKey;

  constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.programId = AGENT_REGISTRY_PROGRAM_ID;
  }

  async getAgent(agentId: bigint): Promise<SolanaAgent | null> {
    const [agentPda] = getAgentPda(agentId);
    const accountInfo = await this.connection.getAccountInfo(agentPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    // Skip discriminator (8 bytes)
    let offset = 8;

    const agentIdRead = data.readBigUInt64LE(offset);
    offset += 8;

    const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;

    const asset = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;

    // Read agent_uri (String = 4-byte len + bytes)
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const agentUri = data.slice(offset, offset + uriLen).toString('utf8');
    offset += uriLen;

    // Read nft_name
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const nftName = data.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;

    // Read nft_symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const nftSymbol = data.slice(offset, offset + symbolLen).toString('utf8');
    offset += symbolLen;

    const createdAt = Number(data.readBigInt64LE(offset));

    return {
      agentId: agentIdRead,
      owner,
      asset,
      agentUri,
      nftName,
      nftSymbol,
      createdAt,
    };
  }

  async getReputation(agentId: bigint): Promise<SolanaReputation | null> {
    const [reputationPda] = getReputationPda(agentId);
    const accountInfo = await this.connection.getAccountInfo(reputationPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    let offset = 8; // Skip discriminator

    const agentIdRead = data.readBigUInt64LE(offset);
    offset += 8;

    offset += 8; // next_feedback_index

    const totalFeedbacks = data.readBigUInt64LE(offset);
    offset += 8;

    offset += 8; // total_score_sum

    const averageScore = data.readUInt8(offset);
    offset += 1;

    const lastUpdated = Number(data.readBigInt64LE(offset));

    return {
      agentId: agentIdRead,
      totalFeedbacks,
      averageScore,
      lastUpdated,
    };
  }

  async getFeedback(agentId: bigint, feedbackIndex: bigint): Promise<SolanaFeedback | null> {
    const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex);
    const accountInfo = await this.connection.getAccountInfo(feedbackPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    let offset = 8; // Skip discriminator

    const agentIdRead = data.readBigUInt64LE(offset);
    offset += 8;

    const clientAddress = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;

    const feedbackIndexRead = data.readBigUInt64LE(offset);
    offset += 8;

    const score = data.readUInt8(offset);
    offset += 1;

    const fileHash = new Uint8Array(data.slice(offset, offset + 32));
    offset += 32;

    const isRevoked = data.readUInt8(offset) === 1;
    offset += 1;

    const createdAt = Number(data.readBigInt64LE(offset));

    return {
      agentId: agentIdRead,
      feedbackIndex: feedbackIndexRead,
      clientAddress,
      score,
      fileHash,
      isRevoked,
      createdAt,
    };
  }

  async getAgentsByOwner(ownerPubkey: string): Promise<SolanaAgent[]> {
    const owner = new PublicKey(ownerPubkey);
    
    // Use getProgramAccounts with memcmp filter on owner field
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { dataSize: 365 }, // AgentAccount max size
        {
          memcmp: {
            offset: 16, // 8 (discriminator) + 8 (agent_id)
            bytes: owner.toBase58(),
          },
        },
      ],
    });

    const agents: SolanaAgent[] = [];
    for (const { account } of accounts) {
      const data = account.data;
      let offset = 8;

      const agentId = data.readBigUInt64LE(offset);
      offset += 8;

      const ownerRead = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      offset += 32;

      const asset = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      offset += 32;

      const uriLen = data.readUInt32LE(offset);
      offset += 4;
      const agentUri = data.slice(offset, offset + uriLen).toString('utf8');
      offset += uriLen;

      const nameLen = data.readUInt32LE(offset);
      offset += 4;
      const nftName = data.slice(offset, offset + nameLen).toString('utf8');
      offset += nameLen;

      const symbolLen = data.readUInt32LE(offset);
      offset += 4;
      const nftSymbol = data.slice(offset, offset + symbolLen).toString('utf8');
      offset += symbolLen;

      const createdAt = Number(data.readBigInt64LE(offset));

      agents.push({
        agentId,
        owner: ownerRead,
        asset,
        agentUri,
        nftName,
        nftSymbol,
        createdAt,
      });
    }

    return agents;
  }

  async getTotalAgents(): Promise<bigint> {
    const [configPda] = getRegistryConfigPda();
    const accountInfo = await this.connection.getAccountInfo(configPda);
    if (!accountInfo) return 0n;

    const data = accountInfo.data;
    // Skip discriminator (8) + authority (32) + next_agent_id (8)
    const totalAgents = data.readBigUInt64LE(8 + 32 + 8);
    return totalAgents;
  }

  computeFederatedId(solanaAgentId: bigint): string {
    // Mirror the EVM FederatedIdentity computation
    // keccak256(abi.encodePacked("jeju:federated:", chainId, ":", agentId))
    // Solana chainId = 101 (mainnet) or 102 (devnet)
    const chainId = this.connection.rpcEndpoint.includes('devnet') ? 102n : 101n;
    return `jeju:federated:${chainId}:${solanaAgentId}`;
  }
}

export function createSolanaIdentityClient(rpcUrl?: string): SolanaIdentityClient {
  return new SolanaIdentityClient(rpcUrl);
}

/**
 * Utility to derive EVM address from Solana pubkey for cross-chain mapping
 * Uses first 20 bytes of keccak256(pubkey)
 */
export function solanaToEvmAddress(solanaPubkey: string): Address {
  const pubkey = new PublicKey(solanaPubkey);
  const bytes = pubkey.toBytes();
  
  // Simple hash - in production would use proper keccak256
  let hash = 0n;
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash * 256n + BigInt(bytes[i])) % (2n ** 160n);
  }
  
  return `0x${hash.toString(16).padStart(40, '0')}` as Address;
}

/**
 * Compute cross-chain identity linking EVM and Solana agents
 */
export async function resolveCrossChainIdentity(
  evmAddress?: Address,
  solanaPubkey?: string,
  solanaClient?: SolanaIdentityClient
): Promise<CrossChainIdentity> {
  const identity: CrossChainIdentity = {
    evmAgentId: null,
    evmChainId: null,
    evmAddress: evmAddress ?? null,
    solanaAgentId: null,
    solanaPubkey: solanaPubkey ?? null,
    federatedId: null,
    reputation: 0,
  };

  if (solanaPubkey && solanaClient) {
    const agents = await solanaClient.getAgentsByOwner(solanaPubkey);
    if (agents.length > 0) {
      const agent = agents[0];
      identity.solanaAgentId = agent.agentId;
      identity.federatedId = solanaClient.computeFederatedId(agent.agentId);
      
      const reputation = await solanaClient.getReputation(agent.agentId);
      if (reputation) {
        identity.reputation = reputation.averageScore;
      }
    }
  }

  return identity;
}

