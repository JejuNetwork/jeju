import {
  ChannelType,
  EventType,
  MemoryType,
  Service,
  createUniqueUuid,
  logger,
  validateUuid,
  type Content,
  type IAgentRuntime,
  type Media,
  type Memory,
  type Plugin,
  type UUID,
} from '@elizaos/core';
import internalMessageBus from '../bus'; // Import the bus
import { AgentServerServiceType } from '../types';

// This interface defines the structure of messages coming from the server
export interface MessageServiceMessage {
  id: UUID; // root_message.id
  channelId: UUID;
  serverId: UUID;
  authorId: UUID; // UUID of a central user identity
  authorDisplayName?: string; // Display name from central user identity
  content: string;
  rawMessage?: unknown;
  sourceId?: string; // original platform message ID
  sourceType?: string;
  inReplyToMessageId?: UUID;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export class MessageBusService extends Service {
  static serviceType = AgentServerServiceType.MESSAGE_BUS_SERVICE;
  // serviceName will be automatically derived as "MessageBus" from class name

  capabilityDescription = 'Manages connection and message synchronization with the message server.';
  private static instances: Map<string, MessageBusService> = new Map();

  private boundHandleIncomingMessage: (data: unknown) => void;
  private boundHandleServerAgentUpdate: (data: unknown) => void;
  private boundHandleMessageDeleted: (data: unknown) => void;
  private boundHandleChannelCleared: (data: unknown) => void;
  private subscribedServers: Set<UUID> = new Set();
  private processedMessages: Set<string> = new Set();

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.boundHandleIncomingMessage = this.handleIncomingMessage.bind(this);
    this.boundHandleServerAgentUpdate = this.handleServerAgentUpdate.bind(this);
    this.boundHandleMessageDeleted = this.handleMessageDeleted.bind(this);
    this.boundHandleChannelCleared = this.handleChannelCleared.bind(this);
    // Don't connect here - let start() handle it
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const agentId = runtime.agentId;

    // Check if instance already exists for this agent
    let service = MessageBusService.instances.get(agentId);
    if (!service) {
      service = new MessageBusService(runtime);
      MessageBusService.instances.set(agentId, service);
      await service.connectToMessageBus();
    }

    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const agentId = runtime.agentId;
    const service = MessageBusService.instances.get(agentId);
    if (service) {
      await service.stop();
      MessageBusService.instances.delete(agentId);
    }
  }

  private async connectToMessageBus() {
    logger.info(
      `[${this.runtime.character.name}] MessageBusService: Subscribing to internal message bus for 'new_message', 'message_deleted', and 'channel_cleared' events.`
    );

    // Remove any existing listeners before adding new ones
    internalMessageBus.off('new_message', this.boundHandleIncomingMessage);
    internalMessageBus.off('server_agent_update', this.boundHandleServerAgentUpdate);
    internalMessageBus.off('message_deleted', this.boundHandleMessageDeleted);
    internalMessageBus.off('channel_cleared', this.boundHandleChannelCleared);

    // Now add the listeners
    internalMessageBus.on('new_message', this.boundHandleIncomingMessage);
    internalMessageBus.on('server_agent_update', this.boundHandleServerAgentUpdate);
    internalMessageBus.on('message_deleted', this.boundHandleMessageDeleted);
    internalMessageBus.on('channel_cleared', this.boundHandleChannelCleared);

    // Delay initial fetch to allow server to start up properly
    // This prevents circular dependency during startup
    setTimeout(async () => {
      try {
        // Initialize by fetching servers this agent belongs to
        await this.fetchAgentServers();
        // Then fetch valid channels for those servers
        await this.fetchValidChannelIds();
      } catch (error) {
        logger.warn(
          `[${this.runtime.character.name}] MessageBusService: Initial fetch failed during startup, will retry later:`,
          error
        );
        // Set up default server and continue - fetches will retry later
        const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
        this.subscribedServers.add(DEFAULT_SERVER_ID);
      }
    }, 5000); // 2 second delay to allow server to fully start
  }

  private validChannelIds: Set<UUID> = new Set();

  private async fetchValidChannelIds(): Promise<void> {
    try {
      const serverApiUrl = this.getCentralMessageServerUrl();

      // Clear existing channel IDs before fetching new ones
      this.validChannelIds.clear();

      // Include the default server ID if not already in subscribed servers
      const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
      const serversToCheck = new Set(this.subscribedServers);
      serversToCheck.add(DEFAULT_SERVER_ID);

      // Fetch channels for each subscribed server
      for (const serverId of serversToCheck) {
        try {
          // Use URL constructor for safe URL building
          const channelsUrl = new URL(
            `/api/messaging/central-servers/${encodeURIComponent(serverId)}/channels`,
            serverApiUrl
          );
          const response = await fetch(channelsUrl.toString(), {
            headers: this.getAuthHeaders(),
          });
          if (response.ok) {
            const data = (await response.json()) as Record<string, unknown>;
            const responseData = data.data as Record<string, unknown>;
            if (data.success && responseData?.channels && Array.isArray(responseData.channels)) {
              // Add channel IDs to the set
              responseData.channels.forEach((channel: Record<string, unknown>) => {
                if (channel.id && validateUuid(channel.id)) {
                  this.validChannelIds.add(channel.id as UUID);
                }
              });
              logger.info(
                `[${this.runtime.character.name}] MessageBusService: Fetched ${responseData.channels.length} channels from server ${serverId}`
              );
            }
          } else {
            logger.warn(
              `[${this.runtime.character.name}] MessageBusService: Failed to fetch channels for server ${serverId}: ${response.status} ${response.statusText}`
            );
          }
        } catch (serverError) {
          logger.error(
            `[${this.runtime.character.name}] MessageBusService: Error fetching channels for server ${serverId}:`,
            serverError
          );
        }
      }

      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Loaded ${this.validChannelIds.size} valid channel IDs from ${serversToCheck.size} servers (including default server)`
      );
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error in fetchValidChannelIds:`,
        error
      );
    }
  }

  private async getChannelParticipants(channelId: UUID): Promise<string[]> {
    try {
      const serverApiUrl = this.getCentralMessageServerUrl();

      if (!validateUuid(channelId)) {
        logger.warn(
          `[${this.runtime.character.name}] MessageBusService: Invalid channel ID format: ${channelId}`
        );
        return [];
      }

      // First check if channel is in our cached set
      if (!this.validChannelIds.has(channelId)) {
        // Try to verify the channel exists by fetching its details
        // Use URL constructor for safe URL building
        const detailsUrl = new URL(
          `/api/messaging/central-channels/${encodeURIComponent(channelId)}/details`,
          serverApiUrl
        );
        const detailsResponse = await fetch(detailsUrl.toString(), {
          headers: this.getAuthHeaders(),
        });

        if (detailsResponse.ok) {
          // Channel exists, add it to our valid set for future use
          this.validChannelIds.add(channelId);
          logger.info(
            `[${this.runtime.character.name}] MessageBusService: Discovered new channel ${channelId}, added to valid channels`
          );
        } else {
          logger.warn(
            `[${this.runtime.character.name}] MessageBusService: Channel ${channelId} does not exist or is not accessible`
          );
          return [];
        }
      }

      // Now fetch the participants
      // Use URL constructor for safe URL building
      const participantsUrl = new URL(
        `/api/messaging/central-channels/${encodeURIComponent(channelId)}/participants`,
        serverApiUrl
      );
      const response = await fetch(participantsUrl.toString(), {
        headers: this.getAuthHeaders(),
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        if (data.success && data.data) {
          return data.data as string[];
        }
      }
      return [];
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error fetching participants for channel ${channelId}:`,
        error
      );
      return [];
    }
  }

  private async fetchAgentServers() {
    try {
      const serverApiUrl = this.getCentralMessageServerUrl();
      // Use URL constructor for safe URL building
      const agentServersUrl = new URL(
        `/api/messaging/agents/${encodeURIComponent(this.runtime.agentId)}/servers`,
        serverApiUrl
      );
      const response = await fetch(agentServersUrl.toString(), {
        headers: this.getAuthHeaders(),
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const responseData = data.data as Record<string, unknown>;
        if (data.success && responseData?.servers) {
          this.subscribedServers = new Set(responseData.servers as UUID[]);
          // Always include the default server
          const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
          this.subscribedServers.add(DEFAULT_SERVER_ID);
          logger.info(
            `[${this.runtime.character.name}] MessageBusService: Agent is subscribed to ${this.subscribedServers.size} servers (including default server)`
          );
        }
      } else {
        // Even if the request fails, ensure we're subscribed to the default server
        const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
        this.subscribedServers.add(DEFAULT_SERVER_ID);
        logger.warn(
          `[${this.runtime.character.name}] MessageBusService: Failed to fetch agent servers, but added default server`
        );
      }
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error fetching agent servers:`,
        error
      );
      // Even on error, ensure we're subscribed to the default server
      const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
      this.subscribedServers.add(DEFAULT_SERVER_ID);
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Added default server after error`
      );
    }
  }

  private async handleServerAgentUpdate(data: unknown) {
    const typedData = data as Record<string, unknown>;
    if (typedData.agentId !== this.runtime.agentId) {
      return; // Not for this agent
    }

    if (typedData.type === 'agent_added_to_server') {
      this.subscribedServers.add(typedData.serverId as UUID);
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Agent added to server ${typedData.serverId}`
      );
      // Refresh channel IDs to include channels from the new server
      await this.fetchValidChannelIds();
    } else if (typedData.type === 'agent_removed_from_server') {
      this.subscribedServers.delete(typedData.serverId as UUID);
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Agent removed from server ${typedData.serverId}`
      );
      // Refresh channel IDs to remove channels from the removed server
      await this.fetchValidChannelIds();
    }
  }

  private async validateServerSubscription(message: MessageServiceMessage): Promise<boolean> {
    const serverId = (message as any).server_id || message.serverId;
    if (!this.subscribedServers.has(serverId)) {
      logger.debug(
        `[${this.runtime.character.name}] MessageBusService: Agent not subscribed to server ${serverId}, ignoring message`
      );
      return false;
    }
    logger.info(
      `[${this.runtime.character.name}] MessageBusService: Passed server subscription check for ${serverId}`
    );
    return true;
  }

  private async validateNotSelfMessage(message: MessageServiceMessage): Promise<boolean> {
    const authorId = (message as any).author_id || message.authorId;
    if (authorId === this.runtime.agentId) {
      logger.debug(
        `[${this.runtime.character.name}] MessageBusService: Agent is the author of the message, ignoring message`
      );
      return false;
    }
    return true;
  }

  private async ensureWorldAndRoomExist(
    message: MessageServiceMessage
  ): Promise<{ agentWorldId: UUID; agentRoomId: UUID }> {
    // Handle both underscore and camelCase versions
    const serverId = (message as any).server_id || message.serverId;
    const channelId = (message as any).channel_id || message.channelId;

    const agentWorldId = createUniqueUuid(this.runtime, serverId);
    const agentRoomId = createUniqueUuid(this.runtime, channelId);

    try {
      await this.runtime.ensureWorldExists({
        id: agentWorldId,
        name:
          ((message.metadata as Record<string, unknown>)?.serverName as string) ||
          `Server ${serverId.substring(0, 8)}`,
        agentId: this.runtime.agentId,
        serverId,
        metadata: {
          ...(message.metadata?.serverMetadata || {}),
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message && error.message.includes('worlds_pkey')) {
        logger.debug(
          `[${this.runtime.character.name}] MessageBusService: World ${agentWorldId} already exists, continuing with message processing`
        );
      } else {
        throw error;
      }
    }

    try {
      await this.runtime.ensureRoomExists({
        id: agentRoomId,
        name:
          ((message.metadata as Record<string, unknown>)?.channelName as string) ||
          `Channel ${channelId.substring(0, 8)}`,
        agentId: this.runtime.agentId,
        worldId: agentWorldId,
        channelId,
        serverId,
        source: message.sourceType || 'central-bus',
        type:
          ((message.metadata as Record<string, unknown>)?.channelType as ChannelType) ||
          ChannelType.GROUP,
        metadata: {
          ...(((message.metadata as Record<string, unknown>)?.channelMetadata as Record<
            string,
            unknown
          >) || {}),
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message && error.message.includes('rooms_pkey')) {
        logger.debug(
          `[${this.runtime.character.name}] MessageBusService: Room ${agentRoomId} already exists, continuing with message processing`
        );
      } else {
        throw error;
      }
    }

    return { agentWorldId, agentRoomId };
  }

  private async ensureAuthorEntityExists(message: MessageServiceMessage): Promise<UUID> {
    const authorId = (message as any).author_id || message.authorId;
    const authorDisplayName = (message as any).author_display_name || message.authorDisplayName;
    const sourceType = (message as any).source_type || message.sourceType;
    const agentAuthorEntityId = createUniqueUuid(this.runtime, authorId);

    const authorEntity = await this.runtime.getEntityById(agentAuthorEntityId);
    if (!authorEntity) {
      await this.runtime.createEntity({
        id: agentAuthorEntityId,
        names: [authorDisplayName || `User-${authorId.substring(0, 8)}`],
        agentId: this.runtime.agentId,
        metadata: {
          authorId,
          source: sourceType,
        },
      });
    }

    return agentAuthorEntityId;
  }

  private createAgentMemory(
    message: MessageServiceMessage,
    agentAuthorEntityId: UUID,
    agentRoomId: UUID,
    agentWorldId: UUID
  ): Memory {
    const sourceType = (message as any).source_type || message.sourceType;
    const inReplyToMessageId =
      (message as any).in_reply_to_message_id || message.inReplyToMessageId;
    const authorId = (message as any).author_id || message.authorId;
    const authorDisplayName = (message as any).author_display_name || message.authorDisplayName;
    const rawMessage = (message as any).raw_message || message.rawMessage;
    const createdAt = (message as any).created_at || message.createdAt;

    const messageContent: Content = {
      text: message.content,
      source: sourceType || 'central-bus',
      attachments: (message.metadata as Record<string, unknown>)?.attachments as
        | Media[]
        | undefined,
      inReplyTo: inReplyToMessageId
        ? createUniqueUuid(this.runtime, inReplyToMessageId)
        : undefined,
    };

    return {
      id: createUniqueUuid(this.runtime, message.id),
      entityId: agentAuthorEntityId,
      agentId: this.runtime.agentId,
      roomId: agentRoomId,
      worldId: agentWorldId,
      content: messageContent,
      createdAt,
      metadata: {
        type: MemoryType.CUSTOM,
        source: sourceType || 'central-bus',
        sourceId: message.id,
        raw: {
          ...rawMessage,
          senderName: authorDisplayName || `User-${authorId.substring(0, 8)}`,
          senderId: authorId,
        },
      },
    };
  }

  public async handleIncomingMessage(messageData: unknown) {
    const message = messageData as MessageServiceMessage;
    logger.info(
      `[${this.runtime.character.name}] MessageBusService: Received message from central bus`,
      { messageId: message.id }
    );

    // Check if we've already processed this message
    if (this.processedMessages.has(message.id)) {
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Message ${message.id} already processed, skipping`
      );
      return;
    }

    // Mark message as processed
    this.processedMessages.add(message.id);

    // Clean up old processed messages to prevent memory leak
    if (this.processedMessages.size > 1000) {
      // Keep only the last 500 messages
      const messagesToKeep = Array.from(this.processedMessages).slice(-500);
      this.processedMessages.clear();
      messagesToKeep.forEach((id) => this.processedMessages.add(id));
    }

    // Transform the channel_id to the agent-specific room ID
    // Handle both channel_id (underscore) and channelId (camelCase) for compatibility
    const channelId = (message as any).channel_id || message.channelId;
    const agentRoomId = createUniqueUuid(this.runtime, channelId);

    // Check if the agent is a participant in the transformed room ID
    try {
      const roomParticipants = await this.runtime.getParticipantsForRoom(agentRoomId);
      const isParticipant = roomParticipants.some((p) => p === this.runtime.agentId);

      if (!isParticipant) {
        // Also check the original channel participants as a fallback
        const channelParticipants = await this.getChannelParticipants(channelId);
        if (!channelParticipants.includes(this.runtime.agentId)) {
          logger.info(
            `[${this.runtime.character.name}] MessageBusService: Agent not a participant in channel ${channelId} (room: ${agentRoomId}), continuing anyway`
          );
          // return;
        }
      }
    } catch (_error) {
      // If room doesn't exist yet, we'll create it below
      logger.debug(`Room ${agentRoomId} may not exist yet, will be created`);
    }

    logger.info(
      `[${this.runtime.character.name} - ${this.runtime.agentId}] MessageBusService: Agent is a participant in channel ${channelId}, proceeding with message processing`
    );

    try {
      if (!(await this.validateServerSubscription(message))) {
        return;
      }
      if (!(await this.validateNotSelfMessage(message))) {
        return;
      }

      logger.info(
        `[${this.runtime.character.name}] MessageBusService: All checks passed, proceeding to create agent memory and emit MESSAGE_RECEIVED event`
      );

      const { agentWorldId, agentRoomId } = await this.ensureWorldAndRoomExist(message);
      const agentAuthorEntityId = await this.ensureAuthorEntityExists(message);
      const agentMemory = this.createAgentMemory(
        message,
        agentAuthorEntityId,
        agentRoomId,
        agentWorldId
      );

      // Check if this memory already exists (in case of duplicate processing)
      const existingMemory = await this.runtime.getMemoryById(agentMemory.id as UUID);
      if (existingMemory) {
        logger.debug(
          `[${this.runtime.character.name}] MessageBusService: Memory ${agentMemory.id} already exists, skipping duplicate processing`
        );
        return;
      }

      const callbackForCentralBus = async (responseContent: Content): Promise<Memory[]> => {
        // Check if this is just a processing notification, not an actual response
        const responseMetadata = (responseContent.metadata as Record<string, unknown>) || {};
        if (
          responseMetadata.type === 'processing-notification' ||
          responseMetadata.isProcessing === true
        ) {
          logger.debug(
            `[${this.runtime.character.name}] Skipping processing notification, not sending to bus`
          );
          return [];
        }

        logger.info(
          `[${this.runtime.character.name}] Agent generated response for message. Preparing to send back to bus.`
        );

        await this.runtime.createMemory(
          {
            entityId: this.runtime.agentId,
            content: responseContent,
            roomId: agentRoomId,
            worldId: agentWorldId,
            agentId: this.runtime.agentId,
          },
          'messages'
        );

        // Send response to central bus
        await this.sendAgentResponseToBus(
          agentRoomId,
          agentWorldId,
          responseContent,
          agentMemory.id,
          message
        );

        // The core runtime/bootstrap plugin will handle creating the agent's own memory of its response.
        // So, we return an empty array here as this callback's primary job is to ferry the response externally.
        return [];
      };

      callbackForCentralBus({
        text: `I received your message: ${message.content}`,
        actions: ['REPLY'],
      });

      await this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
        runtime: this.runtime,
        message: agentMemory,
        callback: callbackForCentralBus,
        onComplete: async () => {
          const room = await this.runtime.getRoom(agentRoomId);
          const world = await this.runtime.getWorld(agentWorldId);

          const channelId = room?.channelId as UUID;
          const serverId = world?.serverId as UUID;
          await this.notifyMessageComplete(channelId, serverId);
        },
      });
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error processing incoming message:`,
        error
      );
    }
  }

  private async handleMessageDeleted(data: unknown) {
    try {
      const typedData = data as Record<string, unknown>;
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Received message_deleted event for message ${typedData.messageId}`
      );

      // Convert the central message ID to the agent's unique memory ID
      const agentMemoryId = createUniqueUuid(this.runtime, typedData.messageId as string);

      // Try to find and delete the existing memory
      const existingMemory = await this.runtime.getMemoryById(agentMemoryId);

      if (existingMemory) {
        // Emit MESSAGE_DELETED event with the existing memory
        await this.runtime.emitEvent(EventType.MESSAGE_DELETED, {
          runtime: this.runtime,
          message: existingMemory,
          source: 'message-bus-service',
        });

        logger.debug(
          `[${this.runtime.character.name}] MessageBusService: Successfully processed message deletion for ${typedData.messageId}`
        );
      } else {
        logger.warn(
          `[${this.runtime.character.name}] MessageBusService: No memory found for deleted message ${typedData.messageId}`
        );
      }
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error handling message deletion:`,
        error
      );
    }
  }

  private async handleChannelCleared(data: unknown) {
    try {
      const typedData = data as Record<string, unknown>;
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Received channel_cleared event for channel ${typedData.channelId}`
      );

      // Convert the central channel ID to the agent's unique room ID
      const agentRoomId = createUniqueUuid(this.runtime, typedData.channelId as string);

      // Get all memories for this room and emit deletion events for each
      const memories = await this.runtime.getMemoriesByRoomIds({
        tableName: 'messages',
        roomIds: [agentRoomId],
      });

      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Found ${memories.length} memories to delete for channel ${typedData.channelId}`
      );

      // Emit CHANNEL_CLEARED event to bootstrap which will handle bulk deletion
      await this.runtime.emitEvent(EventType.CHANNEL_CLEARED, {
        runtime: this.runtime,
        source: 'message-bus-service',
        roomId: agentRoomId,
        channelId: typedData.channelId,
        memoryCount: memories.length,
      });

      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Successfully processed channel clear for ${typedData.channelId} -> room ${agentRoomId}`
      );
    } catch (error) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error handling channel clear:`,
        error
      );
    }
  }

  private async sendAgentResponseToBus(
    agentRoomId: UUID,
    agentWorldId: UUID,
    content: Content,
    inReplyToAgentMemoryId?: UUID,
    originalMessage?: MessageServiceMessage
  ) {
    console.log('Sending agent response to bus');

    const room = await this.runtime.getRoom(agentRoomId);
    const world = await this.runtime.getWorld(agentWorldId);

    const channelId = room?.channelId as UUID;
    const serverId = world?.serverId as UUID;

    if (!channelId || !serverId) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Cannot map agent room/world to central IDs for response. AgentRoomID: ${agentRoomId}, AgentWorldID: ${agentWorldId}. Room or World object missing, or channelId/serverId not found on them.`
      );
      return;
    }

    // If agent decides to IGNORE or has no valid text, notify completion and skip sending response
    const shouldSkip =
      content.actions?.includes('IGNORE') || !content.text || content.text.trim() === '';

    if (shouldSkip) {
      logger.info(
        `[${this.runtime.character.name}] MessageBusService: Skipping response (reason: ${content.actions?.includes('IGNORE') ? 'IGNORE action' : 'No text'})`
      );
      return;
    }

    // Resolve reply-to message ID from agent memory metadata
    let centralInReplyToRootMessageId: UUID | undefined = undefined;
    if (inReplyToAgentMemoryId) {
      const originalAgentMemory = await this.runtime.getMemoryById(inReplyToAgentMemoryId);
      if (originalAgentMemory?.metadata?.sourceId) {
        centralInReplyToRootMessageId = originalAgentMemory.metadata.sourceId as UUID;
      }
    }

    const payloadToServer = {
      channel_id: channelId,
      server_id: serverId,
      author_id: this.runtime.agentId, // This needs careful consideration: is it the agent's core ID or a specific central identity for the agent?
      content: content.text,
      in_reply_to_message_id: centralInReplyToRootMessageId,
      source_type: 'agent_response',
      raw_message: {
        text: content.text,
        thought: content.thought,
        actions: content.actions,
      },
      metadata: {
        agent_id: this.runtime.agentId,
        agentName: this.runtime.character.name,
        attachments: content.attachments,
        channelType: originalMessage?.metadata?.channelType || room?.type,
        isDm:
          originalMessage?.metadata?.isDm ||
          (originalMessage?.metadata?.channelType || room?.type) === ChannelType.DM,
      },
    };

    logger.info(
      `[${this.runtime.character.name}] MessageBusService: Sending payload to central server API endpoint (/api/messaging/submit):`,
      payloadToServer
    );

    // Check if we're in standalone mode (no external central server configured)
    const envUrl = process.env.CENTRAL_MESSAGE_SERVER_URL;
    if (!envUrl) {
      // Running in standalone mode - skip external submission but broadcast to WebSocket clients
      const serverInstance = (global as any).elizaAgentServer;
      if (serverInstance && serverInstance.broadcastToWebSocketClients) {
        serverInstance.broadcastToWebSocketClients(
          {
            type: 'agent_message',
            id: `agent-response-${Date.now()}`,
            content: content.text,
            author: this.runtime.character.name || 'Agent',
            channel_id: channelId,
            timestamp: Date.now(),
            source: 'agent_response',
            thought: content.thought,
            actions: content.actions,
            metadata: payloadToServer.metadata,
          },
          channelId
        );
      }
      return;
    }

    // Actual fetch to the central server API
    const baseUrl = this.getCentralMessageServerUrl();
    // Use URL constructor for safe URL building
    const submitUrl = new URL('/api/messaging/submit', baseUrl);
    const serverApiUrl = submitUrl.toString();
    const response = await fetch(serverApiUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payloadToServer),
    });

    if (!response.ok) {
      logger.error(
        `[${this.runtime.character.name}] MessageBusService: Error sending response to central server: ${response.status} ${await response.text()}`
      );
    } else {
      // Response was successful, also broadcast via WebSocket
      // Get the server instance to access WebSocket broadcast
      const serverInstance = (global as any).elizaAgentServer;
      if (serverInstance && serverInstance.broadcastToWebSocketClients) {
        serverInstance.broadcastToWebSocketClients(
          {
            type: 'agent_message',
            id: `agent-response-${Date.now()}`,
            content: content.text,
            author: this.runtime.character.name || 'Agent',
            channel_id: channelId,
            timestamp: Date.now(),
            source: 'agent_response',
            thought: content.thought,
            actions: content.actions,
            metadata: payloadToServer.metadata,
          },
          channelId
        );

        logger.debug(
          `[${this.runtime.character.name}] MessageBusService: Agent response also broadcasted via WebSocket`
        );
      }
    }
  }

  private async notifyMessageComplete(channelId?: UUID, serverId?: UUID) {
    if (!channelId || !serverId) {
      return;
    }

    try {
      const completeUrl = new URL('/api/messaging/complete', this.getCentralMessageServerUrl());
      await fetch(completeUrl.toString(), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ channelId, serverId }),
      });
    } catch (error) {
      logger.warn(
        `[${this.runtime.character.name}] MessageBusService: Failed to notify completion`,
        error
      );
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication header if ELIZA_SERVER_AUTH_TOKEN is configured
    const serverAuthToken = process.env.ELIZA_SERVER_AUTH_TOKEN;
    if (serverAuthToken) {
      headers['X-API-KEY'] = serverAuthToken;
    }

    return headers;
  }

  getCentralMessageServerUrl(): string {
    const serverPort = process.env.SERVER_PORT;
    const envUrl = process.env.CENTRAL_MESSAGE_SERVER_URL;

    // Validate and sanitize server port
    let validatedPort: number | null = null;
    if (serverPort) {
      const portNum = parseInt(serverPort, 10);
      if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
        validatedPort = portNum;
      } else {
        logger.warn(`[MessageBusService] Invalid SERVER_PORT value: ${serverPort}`);
      }
    }

    // On Windows, use 127.0.0.1 instead of localhost to avoid resolution issues
    const host = process.platform === 'win32' ? '127.0.0.1' : 'localhost';
    const defaultUrl = validatedPort ? `http://${host}:${validatedPort}` : `http://${host}:7777`;
    const baseUrl = envUrl ?? defaultUrl;

    // Strict validation to prevent SSRF attacks
    try {
      const url = new URL(baseUrl);

      // Only allow HTTP/HTTPS protocols
      if (!['http:', 'https:'].includes(url.protocol)) {
        logger.warn(
          `[MessageBusService] Unsafe protocol in CENTRAL_MESSAGE_SERVER_URL: ${url.protocol}`
        );
        return defaultUrl;
      }

      // Only allow safe localhost variants and block private/internal IPs
      const allowedHosts = ['localhost', '127.0.0.1', '::1'];
      if (!allowedHosts.includes(url.hostname)) {
        logger.warn(
          `[MessageBusService] Unsafe hostname in CENTRAL_MESSAGE_SERVER_URL: ${url.hostname}`
        );
        return defaultUrl;
      }

      // Validate port range
      if (url.port) {
        const portNum = parseInt(url.port, 10);
        if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
          logger.warn(
            `[MessageBusService] Invalid port in CENTRAL_MESSAGE_SERVER_URL: ${url.port}`
          );
          return defaultUrl;
        }
      }

      // Remove any potentially dangerous URL components
      url.username = '';
      url.password = '';
      url.hash = '';

      return url.toString().replace(/\/$/, ''); // Remove trailing slash
    } catch (_error) {
      logger.error(
        `[MessageBusService] Invalid URL format in CENTRAL_MESSAGE_SERVER_URL: ${baseUrl}`
      );
      return defaultUrl;
    }
  }

  async stop(): Promise<void> {
    logger.info(`[${this.runtime.character.name}] MessageBusService stopping...`);
    internalMessageBus.off('new_message', this.boundHandleIncomingMessage);
    internalMessageBus.off('server_agent_update', this.boundHandleServerAgentUpdate);
    internalMessageBus.off('message_deleted', this.boundHandleMessageDeleted);
    internalMessageBus.off('channel_cleared', this.boundHandleChannelCleared);

    // Clear processed messages
    this.processedMessages.clear();
  }
}

// Minimal plugin definition to register the service
export const messageBusConnectorPlugin: Plugin = {
  name: 'internal-message-bus-connector',
  description: 'Internal service to connect agent to the message bus.',
  services: [MessageBusService],
};
