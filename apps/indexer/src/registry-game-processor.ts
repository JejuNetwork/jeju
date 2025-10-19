/**
 * Registry Game Processor
 * Indexes games registered to IdentityRegistry with "games" tag
 */

import { EvmBatchProcessorFields, Log as _Log } from '@subsquid/evm-processor';
import { ethers } from 'ethers';

// Event signature for Registered event
const REGISTERED_EVENT = ethers.id('Registered(uint256,address,uint256,uint256,string)');
const TAGS_UPDATED_EVENT = ethers.id('TagsUpdated(uint256,string[])');
const METADATA_SET_EVENT = ethers.id('MetadataSet(uint256,string,bytes)');

export interface RegisteredGame {
  agentId: number;
  entityAddress: string;
  name: string;
  tags: string[];
  gameType?: string;
  metadataURI?: string;
  mudWorldAddress?: string;
  goldTokenAddress?: string;
  itemsTokenAddress?: string;
  escrowAddress?: string;
}

export async function processRegistryEvents(ctx: any): Promise<void> {
  const games = new Map<number, RegisteredGame>();
  
  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      const topic0 = log.topics[0];
      
      // Registered event
      if (topic0 === REGISTERED_EVENT) {
        const agentId = Number(ethers.toBigInt(log.topics[1]));
        
        // Decode event data to get tags
        // Note: This requires proper ABI decoding
        // For now, we'll query the contract for tags
        
        // Check if this is a game (has "games" tag)
        // This would be done via RPC call or from decoded event data
        
        games.set(agentId, {
          agentId,
          entityAddress: '', // From event
          name: '', // From event
          tags: [], // Would decode from event or query
        });
      }
      
      // Tags updated
      if (topic0 === TAGS_UPDATED_EVENT) {
        const agentId = Number(ethers.toBigInt(log.topics[1]));
        // Update tags for this agent
      }
      
      // Metadata set (for contract addresses)
      if (topic0 === METADATA_SET_EVENT) {
        const agentId = Number(ethers.toBigInt(log.topics[1]));
        // Parse metadata key/value
        // If key is "mudWorld" or "goldToken" etc, store it
      }
    }
  }
  
  // Save games to database
  // await ctx.store.upsert(Array.from(games.values()));
}

