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
      // Connected
    });

    this.socket.on('disconnect', (_reason) => {
      // Disconnected
    });

    this.socket.on('connect_error', (_error) => {
      // Connection error handled
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
  }

  leaveChannel(channelId: string) {
    if (!this.socket?.connected) return;

    this.socket.emit('leaveChannel', { channelId });
    if (this.currentChannel === channelId) {
      this.currentChannel = null;
    }
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
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  getCurrentUserId(): string | null {
    return this.userId;
  }
}

export const socketManager = new SocketManager();
export type { MessageData, MessageHandler };

