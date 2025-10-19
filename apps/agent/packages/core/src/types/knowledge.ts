import { DocumentMetadata, Memory } from './memory';
import type { Content, UUID } from './primitives';

/**
 * Defines the scope or visibility of knowledge items within the agent's system.
 * - `SHARED`: Indicates knowledge that is broadly accessible, potentially across different agents or users if the system architecture permits.
 * - `PRIVATE`: Indicates knowledge that is restricted, typically to the specific agent or user context it belongs to.
 * This enum is used to manage access and retrieval of knowledge items, often in conjunction with `AgentRuntime.addKnowledge` or `AgentRuntime.getKnowledge` scopes.
 */
export enum KnowledgeScope {
  SHARED = 'shared',
  PRIVATE = 'private',
}

/**
 * Specifies prefixes for keys used in caching mechanisms, helping to namespace cached data.
 * For example, `KNOWLEDGE` might be used to prefix keys for cached knowledge embeddings or processed documents.
 * This helps in organizing the cache and avoiding key collisions.
 * Used internally by caching strategies, potentially within `IDatabaseAdapter` cache methods or runtime caching layers.
 */
export enum CacheKeyPrefix {
  KNOWLEDGE = 'knowledge',
}

/**
 * Represents an item within a directory listing, specifically for knowledge loading.
 * When an agent's `Character.knowledge` configuration includes a directory, this type
 * is used to specify the path to that directory and whether its contents should be treated as shared.
 * - `directory`: The path to the directory containing knowledge files.
 * - `shared`: An optional boolean (defaults to false) indicating if the knowledge from this directory is considered shared or private.
 */
export interface DirectoryItem {
  /** The path to the directory containing knowledge files. */
  directory: string;
  /** If true, knowledge from this directory is considered shared; otherwise, it's private. Defaults to false. */
  shared?: boolean;
}

/**
 * Represents a row structure, typically from a database query related to text chunking or processing.
 * This interface is quite minimal and seems to be a placeholder or a base for more specific chunk-related types.
 * The `id` would be the unique identifier for the chunk.
 * It might be used when splitting large documents into smaller, manageable pieces for embedding or analysis.
 */
export interface ChunkRow {
  /** The unique identifier for this chunk of text. */
  id: string;
  // Add other properties if needed
}

/**
 * Extended knowledge item that includes additional properties commonly used
 * in knowledge management systems like creation timestamps, embeddings, etc.
 * This maintains compatibility with the base KnowledgeItem while adding
 * commonly needed fields for storage and retrieval.
 */
export interface KnowledgeItem extends Memory {
  /** A Universally Unique Identifier for this specific knowledge item. */
  id: UUID;
  /** The actual content of the knowledge item, which must include text and can have other fields. */
  content: Content;
  /** Optional metadata with extended document properties */
  metadata?: DocumentMetadata;
  /** Creation timestamp */
  createdAt: number;
  /** Associated agent ID */
  agentId: UUID;
  /** Associated entity ID */
  entityId: UUID;
  /** Associated room ID */
  roomId: UUID;
  /** Associated world ID */
  worldId?: UUID;
  /** Optional embedding vector for semantic search */
  embedding?: number[];
  /** Similarity score when retrieved via search */
  similarity?: number;
}

/**
 * Service interface for knowledge management operations.
 * Provides methods for retrieving, storing, and searching knowledge items.
 */
export interface IKnowledgeService {
  getMemories(params: {
    tableName: string;
    count: number;
    agentId: UUID;
  }): Promise<KnowledgeItem[]>;

  deleteMemory?(memoryId: UUID): Promise<void>;

  addKnowledge?(options: {
    clientDocumentId: UUID;
    content: string;
    contentType: string;
    originalFilename: string;
    worldId: UUID;
    roomId: UUID;
    entityId: UUID;
    agentId?: UUID;
    metadata?: Record<string, unknown>;
  }): Promise<{
    clientDocumentId: UUID;
    storedDocumentMemoryId: UUID;
    fragmentCount: number;
  }>;

  searchKnowledge?(params: {
    query: string;
    agentId: UUID;
    limit?: number;
  }): Promise<KnowledgeItem[]>;
}
