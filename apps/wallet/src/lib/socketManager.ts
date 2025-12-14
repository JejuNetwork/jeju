/**
 * Socket.IO Manager for real-time messaging
 * Handles WebSocket connection to ElizaOS
 */

import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_ELIZA_WS_URL || 'http://localhost:3000';

type MessageHandler = (data: MessageData) => void;

interface MessageData {
  id?: string;
  content?: string;
  text?: string;
  message?: string;
  senderId: string;
  channelId: string;
  createdAt: string | number;
  senderName?: string;
  sourceType?: string;
  type?: string;
  rawMessage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

class SocketManager {
  private socket: Socket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private userId: string | null = null;
  private userName: string | null = null;
  private currentChannel: string | null = null;

  connect(userId: string, userName?: string): Socket {
    if (this.socket?.connected && this.userId === userId) {
      return this.socket;
    }

    this.userId = userId;
    this.userName = userName || null;

    // Disconnect existing socket
    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = io(SOCKET_URL, {
      auth: { userId, userName },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected to server');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
    });

    // Listen for messages
    this.socket.on('message', (data: MessageData) => {
      this.messageHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('messageBroadcast', (data: MessageData) => {
      this.messageHandlers.forEach((handler) => handler(data));
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.userId = null;
    this.userName = null;
    this.currentChannel = null;
  }

  setUserName(name: string) {
    this.userName = name;
    if (this.socket?.connected) {
      this.socket.emit('setUserName', { userName: name });
    }
  }

  joinChannel(channelId: string, serverId: string, options?: { isDm?: boolean }) {
    if (!this.socket?.connected) {
      console.warn('[Socket] Cannot join channel - not connected');
      return;
    }

    if (this.currentChannel) {
      this.leaveChannel(this.currentChannel);
    }

    this.currentChannel = channelId;
    this.socket.emit('joinChannel', {
      channelId,
      serverId,
      userId: this.userId,
      ...options,
    });
    console.log('[Socket] Joined channel:', channelId);
  }

  leaveChannel(channelId: string) {
    if (!this.socket?.connected) return;

    this.socket.emit('leaveChannel', { channelId });
    if (this.currentChannel === channelId) {
      this.currentChannel = null;
    }
    console.log('[Socket] Left channel:', channelId);
  }

  sendMessage(
    channelId: string,
    content: string,
    serverId: string,
    options?: {
      userId?: string;
      isDm?: boolean;
      targetUserId?: string;
    }
  ) {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot send message - not connected');
      return;
    }

    const message = {
      channelId,
      content,
      serverId,
      senderId: options?.userId || this.userId,
      senderName: this.userName,
      isDm: options?.isDm,
      targetUserId: options?.targetUserId,
      timestamp: Date.now(),
    };

    this.socket.emit('message', message);
    console.log('[Socket] Sent message to channel:', channelId);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getCurrentUserId(): string | null {
    return this.userId;
  }
}

export const socketManager = new SocketManager();
export type { MessageData, MessageHandler };

