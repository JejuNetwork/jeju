/**
 * @fileoverview WebSocket server for real-time intent updates
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createServer } from 'http';
import type { Intent } from '@jejunetwork/types';

interface WebSocketClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  chainFilters: Set<number>;
}

interface IntentUpdate {
  type: 'intent_created' | 'intent_claimed' | 'intent_filled' | 'intent_expired' | 'intent_settled';
  intent: Intent;
  timestamp: number;
}

interface SolverUpdate {
  type: 'solver_registered' | 'solver_slashed' | 'solver_fill';
  solver: string;
  data: Record<string, unknown>;
  timestamp: number;
}

type WSMessage = 
  | { action: 'subscribe'; channel: string; chainId?: number }
  | { action: 'unsubscribe'; channel: string }
  | { action: 'ping' };

export class IntentWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, WebSocketClient> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval>;

  constructor(port: number = 4012) {
    const server = createServer();
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws) => {
      this.handleConnection(ws);
    });

    server.listen(port, () => {
      console.log(`📡 WebSocket server running on ws://localhost:${port}`);
    });

    // Heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, 30000);
  }

  private handleConnection(ws: WebSocket): void {
    const client: WebSocketClient = {
      ws,
      subscriptions: new Set(),
      chainFilters: new Set(),
    };
    this.clients.set(ws, client);

    console.log(`WebSocket client connected (${this.clients.size} total)`);

    ws.on('message', (data: RawData) => {
      const message = JSON.parse(data.toString()) as WSMessage;
      this.handleMessage(client, message);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`WebSocket client disconnected (${this.clients.size} remaining)`);
    });

    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error.message);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      channels: ['intents', 'solvers', 'stats'],
      timestamp: Date.now(),
    }));
  }

  private handleMessage(client: WebSocketClient, message: WSMessage): void {
    switch (message.action) {
      case 'subscribe':
        client.subscriptions.add(message.channel);
        if (message.chainId) {
          client.chainFilters.add(message.chainId);
        }
        client.ws.send(JSON.stringify({
          type: 'subscribed',
          channel: message.channel,
          chainId: message.chainId,
        }));
        break;

      case 'unsubscribe':
        client.subscriptions.delete(message.channel);
        client.ws.send(JSON.stringify({
          type: 'unsubscribed',
          channel: message.channel,
        }));
        break;

      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
    }
  }

  // Broadcast intent update to subscribed clients
  broadcastIntent(update: IntentUpdate): void {
    const message = JSON.stringify(update);
    
    this.clients.forEach((client) => {
      if (!client.subscriptions.has('intents')) return;
      
      // Apply chain filter if set
      if (client.chainFilters.size > 0) {
        const intentChain = update.intent.sourceChainId;
        const destChain = update.intent.outputs[0]?.chainId;
        if (!client.chainFilters.has(intentChain) && (!destChain || !client.chainFilters.has(destChain))) {
          return;
        }
      }
      
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  // Broadcast solver update
  broadcastSolver(update: SolverUpdate): void {
    const message = JSON.stringify(update);
    
    this.clients.forEach((client) => {
      if (client.subscriptions.has('solvers') && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  // Broadcast stats update
  broadcastStats(stats: Record<string, unknown>): void {
    const message = JSON.stringify({
      type: 'stats_update',
      stats,
      timestamp: Date.now(),
    });
    
    this.clients.forEach((client) => {
      if (client.subscriptions.has('stats') && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}

// Singleton instance
let wsServer: IntentWebSocketServer | null = null;

export function getWebSocketServer(port?: number): IntentWebSocketServer {
  if (!wsServer) {
    wsServer = new IntentWebSocketServer(port);
  }
  return wsServer;
}

export function broadcastIntentUpdate(update: IntentUpdate): void {
  wsServer?.broadcastIntent(update);
}

export function broadcastSolverUpdate(update: SolverUpdate): void {
  wsServer?.broadcastSolver(update);
}

export function broadcastStatsUpdate(stats: Record<string, unknown>): void {
  wsServer?.broadcastStats(stats);
}

