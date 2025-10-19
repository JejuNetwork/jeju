import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc, lt, sql, inArray } from 'drizzle-orm';
import { logger, type UUID, type ChannelType } from '@elizaos/core';
import { getDatabase, closeDatabase } from './connection';
import {
  messageServerTable,
  channelTable,
  channelParticipantsTable,
  messageTable,
  serverAgentsTable,
} from './schema';
import type { MessageServer, MessageChannel, CentralRootMessage } from '../types';

export class MessageDatabaseAdapter {
  // Provide access to the underlying database for raw queries
  get db() {
    return getDatabase();
  }

  // Server methods
  async createMessageServer(
    data: Omit<MessageServer, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MessageServer> {
    const db = getDatabase();
    const id = (data as any).id || uuidv4();
    const now = new Date();

    const [server] = await db
      .insert(messageServerTable)
      .values({
        id,
        name: data.name,
        sourceType: data.sourceType,
        sourceId: data.sourceId || null,
        metadata: data.metadata || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: server.id as UUID,
      name: server.name,
      sourceType: server.sourceType,
      sourceId: server.sourceId || undefined,
      metadata: server.metadata || undefined,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  async getMessageServers(): Promise<MessageServer[]> {
    const db = getDatabase();
    const servers = await db.select().from(messageServerTable);

    return servers.map((server) => ({
      id: server.id as UUID,
      name: server.name,
      sourceType: server.sourceType,
      sourceId: server.sourceId || undefined,
      metadata: server.metadata || undefined,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    }));
  }

  async getMessageServerById(serverId: UUID): Promise<MessageServer | null> {
    const db = getDatabase();
    const [server] = await db
      .select()
      .from(messageServerTable)
      .where(eq(messageServerTable.id, serverId));

    if (!server) return null;

    return {
      id: server.id as UUID,
      name: server.name,
      sourceType: server.sourceType,
      sourceId: server.sourceId || undefined,
      metadata: server.metadata || undefined,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  // Channel methods
  async createChannel(
    data: Omit<MessageChannel, 'id' | 'createdAt' | 'updatedAt'> & { id?: UUID },
    participantIds?: UUID[]
  ): Promise<MessageChannel> {
    const db = getDatabase();
    const id = data.id || uuidv4();
    const now = new Date();

    const [channel] = await db
      .insert(channelTable)
      .values({
        id,
        messageServerId: data.messageServerId,
        name: data.name,
        type: data.type,
        sourceType: data.sourceType || null,
        sourceId: data.sourceId || null,
        topic: data.topic || null,
        metadata: data.metadata || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Add participants if provided
    if (participantIds && participantIds.length > 0) {
      await this.addChannelParticipants(id as UUID, participantIds);
    }

    return {
      id: channel.id as UUID,
      messageServerId: channel.messageServerId as UUID,
      name: channel.name,
      type: channel.type as ChannelType,
      sourceType: channel.sourceType || undefined,
      sourceId: channel.sourceId || undefined,
      topic: channel.topic || undefined,
      metadata: channel.metadata || undefined,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  async addChannelParticipants(channelId: UUID, userIds: UUID[]): Promise<void> {
    const db = getDatabase();
    if (userIds.length === 0) return;

    const values = userIds.map((userId) => ({
      channelId,
      userId,
    }));

    await db.insert(channelParticipantsTable).values(values).onConflictDoNothing();
  }

  async getChannelsForServer(serverId: UUID): Promise<MessageChannel[]> {
    const db = getDatabase();
    const channels = await db
      .select()
      .from(channelTable)
      .where(eq(channelTable.messageServerId, serverId));

    return channels.map((channel) => ({
      id: channel.id as UUID,
      messageServerId: channel.messageServerId as UUID,
      name: channel.name,
      type: channel.type as ChannelType,
      sourceType: channel.sourceType || undefined,
      sourceId: channel.sourceId || undefined,
      topic: channel.topic || undefined,
      metadata: channel.metadata || undefined,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    }));
  }

  async getChannelDetails(channelId: UUID): Promise<MessageChannel | null> {
    const db = getDatabase();
    const [channel] = await db.select().from(channelTable).where(eq(channelTable.id, channelId));

    if (!channel) return null;

    return {
      id: channel.id as UUID,
      messageServerId: channel.messageServerId as UUID,
      name: channel.name,
      type: channel.type as ChannelType,
      sourceType: channel.sourceType || undefined,
      sourceId: channel.sourceId || undefined,
      topic: channel.topic || undefined,
      metadata: channel.metadata || undefined,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  async getChannelParticipants(channelId: UUID): Promise<UUID[]> {
    const db = getDatabase();
    const participants = await db
      .select()
      .from(channelParticipantsTable)
      .where(eq(channelParticipantsTable.channelId, channelId));

    return participants.map((p) => p.userId as UUID);
  }

  async updateChannel(
    channelId: UUID,
    updates: { name?: string; participantCentralUserIds?: UUID[]; metadata?: any }
  ): Promise<MessageChannel> {
    const db = getDatabase();
    const updateData: any = { updatedAt: new Date() };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

    const [channel] = await db
      .update(channelTable)
      .set(updateData)
      .where(eq(channelTable.id, channelId))
      .returning();

    // Update participants if provided
    if (updates.participantCentralUserIds) {
      // Remove all existing participants
      await db
        .delete(channelParticipantsTable)
        .where(eq(channelParticipantsTable.channelId, channelId));

      // Add new participants
      if (updates.participantCentralUserIds.length > 0) {
        await this.addChannelParticipants(channelId, updates.participantCentralUserIds);
      }
    }

    return {
      id: channel.id as UUID,
      messageServerId: channel.messageServerId as UUID,
      name: channel.name,
      type: channel.type as ChannelType,
      sourceType: channel.sourceType || undefined,
      sourceId: channel.sourceId || undefined,
      topic: channel.topic || undefined,
      metadata: channel.metadata || undefined,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  async deleteChannel(channelId: UUID): Promise<void> {
    const db = getDatabase();
    await db.delete(channelTable).where(eq(channelTable.id, channelId));
  }

  async findOrCreateDmChannel(
    user1Id: UUID,
    user2Id: UUID,
    messageServerId: UUID
  ): Promise<MessageChannel> {
    const db = getDatabase();

    // Find existing DM channel between these two users
    const existingChannels = await db
      .select({
        channel: channelTable,
        participants: sql<string[]>`array_agg(${channelParticipantsTable.userId})`,
      })
      .from(channelTable)
      .innerJoin(channelParticipantsTable, eq(channelTable.id, channelParticipantsTable.channelId))
      .where(and(eq(channelTable.type, 'dm'), eq(channelTable.messageServerId, messageServerId)))
      .groupBy(channelTable.id)
      .having(
        sql`array_agg(${channelParticipantsTable.userId} ORDER BY ${channelParticipantsTable.userId}) = ARRAY[${user1Id}, ${user2Id}]::text[] OR array_agg(${channelParticipantsTable.userId} ORDER BY ${channelParticipantsTable.userId}) = ARRAY[${user2Id}, ${user1Id}]::text[]`
      );

    if (existingChannels.length > 0) {
      const channel = existingChannels[0].channel;
      return {
        id: channel.id as UUID,
        messageServerId: channel.messageServerId as UUID,
        name: channel.name,
        type: channel.type as ChannelType,
        sourceType: channel.sourceType || undefined,
        sourceId: channel.sourceId || undefined,
        topic: channel.topic || undefined,
        metadata: channel.metadata || undefined,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      };
    }

    // Create new DM channel
    return this.createChannel(
      {
        messageServerId,
        name: 'Direct Message',
        type: 'dm' as ChannelType,
      },
      [user1Id, user2Id]
    );
  }

  // Message methods
  async createMessage(
    data: Omit<CentralRootMessage, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CentralRootMessage> {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date();

    const [message] = await db
      .insert(messageTable)
      .values({
        id,
        channelId: data.channelId,
        authorId: data.authorId,
        content: data.content,
        rawMessage: data.rawMessage || null,
        inReplyToRootMessageId: data.inReplyToRootMessageId || null,
        sourceType: data.sourceType || null,
        sourceId: data.sourceId || null,
        metadata: data.metadata || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: message.id as UUID,
      channelId: message.channelId as UUID,
      authorId: message.authorId as UUID,
      content: message.content,
      rawMessage: message.rawMessage || undefined,
      inReplyToRootMessageId: message.inReplyToRootMessageId as UUID | undefined,
      sourceType: message.sourceType || undefined,
      sourceId: message.sourceId || undefined,
      metadata: message.metadata || undefined,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  async getMessagesForChannel(
    channelId: UUID,
    limit: number = 50,
    beforeTimestamp?: Date
  ): Promise<CentralRootMessage[]> {
    const db = getDatabase();

    const whereConditions = beforeTimestamp
      ? and(eq(messageTable.channelId, channelId), lt(messageTable.createdAt, beforeTimestamp))!
      : eq(messageTable.channelId, channelId);

    const messages = await db
      .select()
      .from(messageTable)
      .where(whereConditions)
      .orderBy(desc(messageTable.createdAt))
      .limit(limit);

    return messages.map((message) => ({
      id: message.id as UUID,
      channelId: message.channelId as UUID,
      authorId: message.authorId as UUID,
      content: message.content,
      rawMessage: message.rawMessage || undefined,
      inReplyToRootMessageId: message.inReplyToRootMessageId as UUID | undefined,
      sourceType: message.sourceType || undefined,
      sourceId: message.sourceId || undefined,
      metadata: message.metadata || undefined,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    }));
  }

  async deleteMessage(messageId: UUID): Promise<void> {
    const db = getDatabase();
    await db.delete(messageTable).where(eq(messageTable.id, messageId));
  }

  // Server-Agent association methods
  async addAgentToServer(serverId: UUID, agentId: UUID): Promise<void> {
    const db = getDatabase();
    await db.insert(serverAgentsTable).values({ serverId, agentId }).onConflictDoNothing();
  }

  async removeAgentFromServer(serverId: UUID, agentId: UUID): Promise<void> {
    const db = getDatabase();
    await db
      .delete(serverAgentsTable)
      .where(and(eq(serverAgentsTable.serverId, serverId), eq(serverAgentsTable.agentId, agentId)));
  }

  async getAgentsForServer(serverId: UUID): Promise<UUID[]> {
    const db = getDatabase();
    const agents = await db
      .select()
      .from(serverAgentsTable)
      .where(eq(serverAgentsTable.serverId, serverId));

    return agents.map((a) => a.agentId as UUID);
  }

  // Additional helper methods
  async execute(query: any): Promise<any> {
    const db = getDatabase();
    return db.execute(query);
  }

  // Close database connection
  async close(): Promise<void> {
    await closeDatabase();
  }
}
