import { logger, validateUuid, type UUID } from '@elizaos/core';
import express from 'express';
import internalMessageBus from '../../bus'; // Import the bus
import type { AgentServer } from '../../server';
import type { MessageServiceStructure as MessageService } from '../../types';

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID; // Single default server

/**
 * Core messaging functionality - message submission and ingestion
 */
export function createMessagingCoreRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // Endpoint for AGENT REPLIES or direct submissions to the central bus FROM AGENTS/SYSTEM
  (router as any).post('/submit', async (req: express.Request, res: express.Response) => {
    const {
      channel_id,
      server_id, // This is the server_id
      author_id, // This should be the agent's runtime.agentId or a dedicated central ID for the agent
      content,
      in_reply_to_message_id, // This is a root_message.id
      source_type,
      raw_message,
      metadata, // Should include agent_name if author_id is agent's runtime.agentId
    } = req.body;

    // Special handling for default server ID "0"
    const isValidServerId = server_id === DEFAULT_SERVER_ID || validateUuid(server_id);

    if (
      !validateUuid(channel_id) ||
      !validateUuid(author_id) ||
      !content ||
      !isValidServerId ||
      !source_type ||
      !raw_message
    ) {
      return res.status(400).json({
        success: false,
        error:
          'Missing required fields: channel_id, server_id, author_id, content, source_type, raw_message',
      });
    }

    // Validate in_reply_to_message_id only if it's provided
    if (in_reply_to_message_id && !validateUuid(in_reply_to_message_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid in_reply_to_message_id format',
      });
    }

    try {
      // Check if channel exists, create if not (for autonomous thoughts)
      let channel = await serverInstance.getChannelDetails(channel_id as UUID);
      if (!channel) {
        logger.info(
          `[Messages Router /submit] Channel ${channel_id} does not exist, creating it...`
        );

        // Use the provided server_id
        const serverId = server_id as UUID;

        // Create the channel
        channel = await serverInstance.createChannel({
          id: channel_id as UUID,
          serverId,
          name: metadata?.channel_name || `Agent Channel ${channel_id.substring(0, 8)}`,
          type: 'GROUP' as any,
          sourceType: source_type || 'agent',
          metadata: {
            created_by: 'agent_submit_api',
            created_for: author_id,
            created_at: new Date().toISOString(),
            ...metadata,
          },
        });

        logger.info(`[Messages Router /submit] Created channel ${channel_id} successfully`);
      }

      const newRootMessageData = {
        channelId: validateUuid(channel_id)!,
        authorId: validateUuid(author_id)!,
        content: content as string,
        rawMessage: raw_message,
        source_type: source_type || 'agent_response',
        inReplyToRootMessageId: in_reply_to_message_id
          ? validateUuid(in_reply_to_message_id) || undefined
          : undefined,
        metadata,
      };
      // Use AgentServer's method to create the message in the DB
      const createdMessage = await serverInstance.createMessage(newRootMessageData);

      // Emit to Websocket for real-time GUI updates
      if (serverInstance.websocket) {
        serverInstance.websocket.to(channel_id).emit('messageBroadcast', {
          senderId: author_id, // This is the agent's ID
          senderName: metadata?.agentName || 'Agent',
          text: content,
          roomId: channel_id, // For Websocket, room is the central channel_id
          serverId: server_id, // Client layer uses serverId
          createdAt: new Date(createdMessage.createdAt).getTime(),
          source: createdMessage.source_type,
          id: createdMessage.id, // Central message ID
          thought: raw_message?.thought,
          actions: raw_message?.actions,
          attachments: metadata?.attachments,
        });
      }

      // Also broadcast to native WebSocket clients (for Tauri game)
      if (serverInstance.broadcastToWebSocketClients) {
        serverInstance.broadcastToWebSocketClients(
          {
            type: 'agent_message',
            id: createdMessage.id,
            content,
            author: metadata?.agentName || 'Agent',
            channel_id,
            timestamp: new Date(createdMessage.createdAt).getTime(),
            source: createdMessage.source_type,
            thought: raw_message?.thought,
            actions: raw_message?.actions,
            metadata,
          },
          channel_id
        );
      }
      // NO broadcast to internalMessageBus here, this endpoint is for messages ALREADY PROCESSED by an agent
      // or system messages that don't need further agent processing via the bus.

      res.status(201).json({ success: true, data: createdMessage });
    } catch (error) {
      logger.error('[Messages Router /submit] Error submitting agent message:', error);
      res.status(500).json({ success: false, error: 'Failed to submit agent message' });
    }
  });

  // Endpoint to notify that a message is complete (e.g., agent finished responding)
  (router as any).post('/complete', async (req: express.Request, res: express.Response) => {
    const { channel_id, server_id } = req.body;

    if (!validateUuid(channel_id) || !validateUuid(server_id)) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid fields: channel_id, server_id',
      });
    }

    try {
      if (serverInstance.websocket) {
        serverInstance.websocket.to(channel_id).emit('messageComplete', {
          channelId: channel_id,
          serverId: server_id,
        });
      }

      res.status(200).json({ success: true, message: 'Completion event emitted' });
    } catch (error) {
      logger.error('[Messages Router /notify-complete] Error notifying message complete:', error);
      res.status(500).json({ success: false, error: 'Failed to notify message completion' });
    }
  });

  // Endpoint for INGESTING messages from EXTERNAL platforms (e.g., Discord plugin)
  (router as any).post('/ingest-external', async (req: express.Request, res: express.Response) => {
    const messagePayload = req.body as Partial<MessageService>; // Partial because ID, created_at will be generated

    if (
      !messagePayload.channel_id ||
      !messagePayload.server_id ||
      !messagePayload.author_id ||
      !messagePayload.content
    ) {
      return res.status(400).json({ success: false, error: 'Invalid external message payload' });
    }

    try {
      const messageToCreate = {
        channelId: messagePayload.channel_id as UUID,
        authorId: messagePayload.author_id as UUID, // This is the original author's ID from the platform (needs mapping to central user ID later)
        content: messagePayload.content as string,
        rawMessage: messagePayload.raw_message,
        sourceId: messagePayload.source_id, // Original platform message ID
        source_type: messagePayload.source_type,
        inReplyToRootMessageId: messagePayload.in_reply_to_message_id
          ? validateUuid(messagePayload.in_reply_to_message_id) || undefined
          : undefined,
        metadata: messagePayload.metadata,
      };
      const createdRootMessage = await serverInstance.createMessage(messageToCreate);

      // Prepare message for the internal bus (for agents to consume)
      const messageForBus: MessageService = {
        id: createdRootMessage.id!,
        channelId: createdRootMessage.channelId,
        serverId: messagePayload.server_id as UUID, // Pass through the original server_id
        authorId: createdRootMessage.authorId, // This is the central ID used for storage
        authorDisplayName: messagePayload.author_display_name, // Pass through display name
        content: createdRootMessage.content,
        rawMessage: createdRootMessage.rawMessage,
        sourceId: createdRootMessage.sourceId,
        source_type: createdRootMessage.source_type,
        inReplyToMessageId: createdRootMessage.inReplyToRootMessageId,
        createdAt: new Date(createdRootMessage.createdAt).getTime(),
        metadata: createdRootMessage.metadata,
      };

      internalMessageBus.emit('new_message', messageForBus);
      logger.info(
        '[Messages Router /ingest-external] Published to internal message bus:',
        createdRootMessage.id
      );

      // Also emit to Websocket for real-time GUI updates if anyone is watching this channel
      if (serverInstance.websocket) {
        serverInstance.websocket.to(messageForBus.channelId).emit('messageBroadcast', {
          senderId: messageForBus.authorId,
          senderName: messageForBus.authorDisplayName || 'User',
          text: messageForBus.content,
          roomId: messageForBus.channelId,
          serverId: messageForBus.serverId, // Client layer uses serverId
          createdAt: messageForBus.createdAt,
          source: messageForBus.source_type,
          id: messageForBus.id,
        });
      }

      res.status(202).json({
        success: true,
        message: 'Message ingested and published to bus',
        data: { messageId: createdRootMessage.id },
      });
    } catch (error) {
      logger.error('[Messages Router /ingest-external] Error ingesting external message:', error);
      res.status(500).json({ success: false, error: 'Failed to ingest message' });
    }
  });

  // Endpoint for SYNCHRONOUS messaging - sends message and waits for agent response
  (router as any).post('/send-and-wait', async (req: express.Request, res: express.Response) => {
    const messagePayload = req.body as Partial<MessageService>;
    const timeoutMs = 15000; // 15 second timeout

    if (
      !messagePayload.channel_id ||
      !messagePayload.server_id ||
      !messagePayload.author_id ||
      !messagePayload.content
    ) {
      return res.status(400).json({ success: false, error: 'Invalid message payload' });
    }

    try {
      // Create the user message first
      const messageToCreate = {
        channelId: messagePayload.channel_id as UUID,
        authorId: messagePayload.author_id as UUID,
        content: messagePayload.content as string,
        rawMessage: messagePayload.raw_message,
        sourceId: messagePayload.source_id,
        source_type: messagePayload.source_type || 'game_ui',
        inReplyToRootMessageId: messagePayload.in_reply_to_message_id
          ? validateUuid(messagePayload.in_reply_to_message_id) || undefined
          : undefined,
        metadata: messagePayload.metadata,
      };

      const createdUserMessage = await serverInstance.createMessage(messageToCreate);

      // Set up a promise to wait for the agent's response
      const responsePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Agent response timeout'));
        }, timeoutMs);

        // Listen for new messages in the same channel from agents
        const checkForResponse = async () => {
          try {
            // Get recent messages from the channel to find agent responses
            const recentMessages = await serverInstance.getChannelMessages(
              messagePayload.channel_id as UUID,
              5 // Get last 5 messages
            );

            // Find an agent response that's newer than our user message
            const agentResponse = recentMessages.find(
              (msg) =>
                msg.createdAt > createdUserMessage.createdAt &&
                msg.source_type === 'agent_response' &&
                msg.channelId === messagePayload.channel_id
            );

            if (agentResponse) {
              clearTimeout(timeout);
              resolve(agentResponse.content);
            } else {
              // Keep checking every 500ms
              setTimeout(checkForResponse, 500);
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };

        // Start checking after a brief delay to allow agent processing
        setTimeout(checkForResponse, 1000);
      });

      // Publish to internal message bus for agent processing
      const messageForBus: MessageService = {
        id: createdUserMessage.id!,
        channelId: createdUserMessage.channelId,
        serverId: messagePayload.server_id as UUID,
        authorId: createdUserMessage.authorId,
        authorDisplayName: messagePayload.author_display_name || 'User',
        content: createdUserMessage.content,
        rawMessage: createdUserMessage.rawMessage,
        sourceId: createdUserMessage.sourceId,
        source_type: createdUserMessage.source_type,
        inReplyToMessageId: createdUserMessage.inReplyToRootMessageId,
        createdAt: new Date(createdUserMessage.createdAt).getTime(),
        metadata: createdUserMessage.metadata,
      };

      internalMessageBus.emit('new_message', messageForBus);
      logger.info(
        '[SYNC MESSAGING] Published message to bus, waiting for agent response:',
        createdUserMessage.id
      );

      // Wait for agent response
      try {
        const agentResponse = await responsePromise;

        res.status(200).json({
          success: true,
          message: 'Message processed successfully',
          data: {
            messageId: createdUserMessage.id,
            agentResponse,
          },
        });
      } catch (error) {
        logger.error('[SYNC MESSAGING] Agent response timeout or error:', error);
        res.status(500).json({
          success: false,
          error: 'Agent did not respond in time',
          data: {
            messageId: createdUserMessage.id,
            agentResponse:
              "I apologize, but I'm having trouble responding right now. Please try again.",
          },
        });
      }
    } catch (error) {
      logger.error('[SYNC MESSAGING] Error in send-and-wait:', error);
      res.status(500).json({ success: false, error: 'Failed to process message' });
    }
  });

  return router;
}
