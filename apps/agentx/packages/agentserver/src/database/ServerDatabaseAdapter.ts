import { type UUID } from '@elizaos/core';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import {
  messageServerTable,
  channelTable,
  messageTable,
  channelParticipantsTable,
  serverAgentsTable,
} from '../schema';

export interface MessageServer {
  id: UUID;
  name: string;
  sourceType: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Channel {
  id: string;
  serverId: UUID;
  name: string;
  type: string;
  sourceType?: string;
  sourceId?: string;
  topic?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  rawMessage?: unknown;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  inReplyToRootMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Define the minimal database type we need
type DrizzleDatabase = {
  insert: (table: any) => any;
  select: () => any;
  update: (table: any) => any;
  delete: (table: any) => any;
  execute: (query: any) => Promise<any>;
};

/**
 * ServerDatabaseAdapter handles server-specific database operations
 * This adapter manages message servers, channels, and messaging infrastructure
 * that is specific to the server implementation and not part of the core agent functionality
 */
export class ServerDatabaseAdapter {
  constructor(private db: DrizzleDatabase) {}

  /**
   * Creates a new message server
   */
  async createMessageServer(data: {
    id?: UUID;
    name: string;
    sourceType: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MessageServer> {
    const id = data.id || (crypto.randomUUID() as UUID);
    const now = new Date();

    await this.db.insert(messageServerTable).values({
      id,
      name: data.name,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    });

    // Fetch and return the created server
    const result = await this.db
      .select()
      .from(messageServerTable)
      .where(eq(messageServerTable.id, id))
      .limit(1);

    return {
      id: result[0].id,
      name: result[0].name,
      sourceType: result[0].sourceType,
      sourceId: result[0].sourceId || undefined,
      metadata: result[0].metadata || undefined,
      createdAt: result[0].createdAt,
      updatedAt: result[0].updatedAt,
    };
  }

  /**
   * Gets all message servers
   */
  async getMessageServers(): Promise<MessageServer[]> {
    const results = await this.db.select().from(messageServerTable);
    return results.map((r: Record<string, unknown>) => ({
      id: r.id as UUID,
      name: r.name as string,
      sourceType: r.sourceType as string,
      sourceId: (r.sourceId as string) || undefined,
      metadata: (r.metadata as Record<string, unknown>) || undefined,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    }));
  }

  /**
   * Gets a message server by ID
   */
  async getMessageServerById(serverId: UUID): Promise<MessageServer | null> {
    const results = await this.db
      .select()
      .from(messageServerTable)
      .where(eq(messageServerTable.id, serverId))
      .limit(1);
    return results.length > 0
      ? {
          id: results[0].id as UUID,
          name: results[0].name,
          sourceType: results[0].sourceType,
          sourceId: results[0].sourceId || undefined,
          metadata: results[0].metadata || undefined,
          createdAt: results[0].createdAt,
          updatedAt: results[0].updatedAt,
        }
      : null;
  }

  /**
   * Creates a channel
   */
  async createChannel(data: {
    id?: string;
    serverId: UUID;
    name: string;
    type: string;
    sourceType?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Channel> {
    const now = new Date();
    const channelId = data.id || crypto.randomUUID();

    const channelToInsert = {
      id: channelId,
      serverId: data.serverId,
      name: data.name,
      type: data.type,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(channelTable).values(channelToInsert).onConflictDoNothing();

    // If channel already existed, fetch it
    if (data.id) {
      const existing = await this.db
        .select()
        .from(channelTable)
        .where(eq(channelTable.id, data.id))
        .limit(1);
      if (existing.length > 0) {
        return {
          id: existing[0].id,
          serverId: existing[0].serverId,
          name: existing[0].name,
          type: existing[0].type,
          sourceType: existing[0].sourceType || undefined,
          sourceId: existing[0].sourceId || undefined,
          metadata: existing[0].metadata || undefined,
          createdAt: existing[0].createdAt,
          updatedAt: existing[0].updatedAt,
        };
      }
    }

    return channelToInsert;
  }

  /**
   * Gets channels for a server
   */
  async getChannelsForServer(serverId: UUID): Promise<Channel[]> {
    const results = await this.db
      .select()
      .from(channelTable)
      .where(eq(channelTable.serverId, serverId));
    return results.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      serverId: r.serverId as UUID,
      name: r.name as string,
      type: r.type as string,
      sourceType: (r.sourceType as string) || undefined,
      sourceId: (r.sourceId as string) || undefined,
      metadata: (r.metadata as Record<string, unknown>) || undefined,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    }));
  }

  /**
   * Adds an agent to a server
   */
  async addAgentToServer(serverId: UUID, agentId: UUID): Promise<void> {
    await this.db.insert(serverAgentsTable).values({ serverId, agentId }).onConflictDoNothing();
  }

  /**
   * Gets agents for a server
   */
  async getAgentsForServer(serverId: UUID): Promise<UUID[]> {
    const results = await this.db
      .select()
      .from(serverAgentsTable)
      .where(eq(serverAgentsTable.serverId, serverId));
    return results.map((r: Record<string, unknown>) => r.agentId as UUID);
  }

  /**
   * Removes an agent from a server
   */
  async removeAgentFromServer(serverId: UUID, agentId: UUID): Promise<void> {
    await this.db
      .delete(serverAgentsTable)
      .where(
        sql`${serverAgentsTable.serverId} = ${serverId} AND ${serverAgentsTable.agentId} = ${agentId}`
      );
  }

  /**
   * Creates a message
   */
  async createMessage(data: {
    id?: string;
    channelId: string;
    authorId: string;
    content: string;
    rawMessage?: unknown;
    sourceType?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    const now = new Date();
    const messageId = data.id || crypto.randomUUID();

    const messageToInsert = {
      id: messageId,
      channelId: data.channelId,
      authorId: data.authorId,
      content: data.content,
      rawMessage: data.rawMessage || null,
      inReplyToRootMessageId: null,
      sourceType: data.sourceType || null,
      sourceId: data.sourceId || null,
      metadata: data.metadata || null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(messageTable).values(messageToInsert);

    return {
      id: messageToInsert.id,
      channelId: messageToInsert.channelId,
      authorId: messageToInsert.authorId,
      content: messageToInsert.content,
      rawMessage: messageToInsert.rawMessage || undefined,
      sourceType: messageToInsert.sourceType || undefined,
      sourceId: messageToInsert.sourceId || undefined,
      metadata: messageToInsert.metadata || undefined,
      createdAt: messageToInsert.createdAt,
      updatedAt: messageToInsert.updatedAt,
    };
  }

  /**
   * Gets messages for a channel
   */
  async getMessagesForChannel(
    channelId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    const results = await this.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.channelId, channelId))
      .orderBy(sql`${messageTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return results.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      channelId: r.channelId as string,
      authorId: r.authorId as string,
      content: r.content as string,
      rawMessage: (r.rawMessage as unknown) || undefined,
      sourceType: (r.sourceType as string) || undefined,
      sourceId: (r.sourceId as string) || undefined,
      metadata: (r.metadata as Record<string, unknown>) || undefined,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    }));
  }

  /**
   * Adds a participant to a channel
   */
  async addParticipantToChannel(channelId: string, userId: UUID): Promise<void> {
    const now = new Date();
    await this.db
      .insert(channelParticipantsTable)
      .values({
        channelId,
        userId,
        joinedAt: now,
      })
      .onConflictDoNothing();
  }

  /**
   * Gets participants for a channel
   */
  async getParticipantsForChannel(channelId: string): Promise<UUID[]> {
    const results = await this.db
      .select()
      .from(channelParticipantsTable)
      .where(eq(channelParticipantsTable.channelId, channelId));
    return results.map((r: Record<string, unknown>) => r.userId as UUID);
  }

  /**
   * Removes a participant from a channel
   */
  async removeParticipantFromChannel(channelId: string, userId: UUID): Promise<void> {
    await this.db
      .delete(channelParticipantsTable)
      .where(
        sql`${channelParticipantsTable.channelId} = ${channelId} AND ${channelParticipantsTable.userId} = ${userId}`
      );
  }

  /**
   * Finds or creates a DM channel between two entities
   */
  async findOrCreateDmChannel(serverId: UUID, entity1Id: UUID, entity2Id: UUID): Promise<Channel> {
    // Sort entity IDs to ensure consistent channel lookup
    const [sortedEntity1, sortedEntity2] = [entity1Id, entity2Id].sort();
    const dmChannelName = `dm_${sortedEntity1}_${sortedEntity2}`;

    // Check if DM channel already exists
    const existingChannels = await this.getChannelsForServer(serverId);
    const existingDm = existingChannels.find((c) => c.type === 'DM' && c.name === dmChannelName);

    if (existingDm) {
      return existingDm;
    }

    // Create new DM channel
    const channel = await this.createChannel({
      serverId,
      name: dmChannelName,
      type: 'DM',
      metadata: {
        participants: [sortedEntity1, sortedEntity2],
      },
    });

    // Add both participants
    await this.addParticipantToChannel(channel.id, entity1Id);
    await this.addParticipantToChannel(channel.id, entity2Id);

    return channel;
  }

  /**
   * Gets channel details by ID
   */
  async getChannelDetails(channelId: string): Promise<Channel | null> {
    const results = await this.db
      .select()
      .from(channelTable)
      .where(eq(channelTable.id, channelId))
      .limit(1);

    return results.length > 0
      ? {
          id: results[0].id,
          serverId: results[0].serverId,
          name: results[0].name,
          type: results[0].type,
          sourceType: results[0].sourceType || undefined,
          sourceId: results[0].sourceId || undefined,
          metadata: results[0].metadata || undefined,
          createdAt: results[0].createdAt,
          updatedAt: results[0].updatedAt,
        }
      : null;
  }

  /**
   * Updates a channel
   */
  async updateChannel(
    channelId: string,
    updates: { name?: string; metadata?: Record<string, unknown> }
  ): Promise<Channel> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.name) {
      updateData.name = updates.name;
    }
    if (updates.metadata) {
      updateData.metadata = updates.metadata;
    }

    await this.db.update(channelTable).set(updateData).where(eq(channelTable.id, channelId));

    const updated = await this.getChannelDetails(channelId);
    if (!updated) {
      throw new Error(`Channel ${channelId} not found after update`);
    }
    return updated;
  }

  /**
   * Deletes a channel
   */
  async deleteChannel(channelId: string): Promise<void> {
    await this.db.delete(channelTable).where(eq(channelTable.id, channelId));
  }

  /**
   * Deletes a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.db.delete(messageTable).where(eq(messageTable.id, messageId));
  }
}
