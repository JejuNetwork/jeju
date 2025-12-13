/**
 * Jeju Messaging Relay Node Server
 * 
 * Handles message routing, storage, and delivery for the decentralized
 * messaging network.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { MessageEnvelope } from '../sdk/types';

// ============ Types ============

interface StoredMessage {
  envelope: MessageEnvelope;
  cid: string;
  receivedAt: number;
  deliveredAt?: number;
  storedOnIPFS: boolean;
}

interface Subscriber {
  address: string;
  ws: WebSocket;
  subscribedAt: number;
}

interface NodeConfig {
  port: number;
  nodeId?: string;
  ipfsUrl?: string;
  maxMessageSize?: number;
  messageRetentionDays?: number;
}

// ============ In-Memory Storage ============

// Message storage (in production, use LevelDB or similar)
const messages = new Map<string, StoredMessage>();

// Pending messages per recipient
const pendingByRecipient = new Map<string, string[]>();

// WebSocket subscribers
const subscribers = new Map<string, Subscriber>();

// Stats
let totalMessagesRelayed = 0;
let totalBytesRelayed = 0;

// ============ Helper Functions ============

function generateCID(content: string): string {
  const hash = sha256(new TextEncoder().encode(content));
  return 'Qm' + bytesToHex(hash).slice(0, 44);
}

function addPendingMessage(recipient: string, messageId: string): void {
  const pending = pendingByRecipient.get(recipient.toLowerCase()) ?? [];
  pending.push(messageId);
  pendingByRecipient.set(recipient.toLowerCase(), pending);
}

function getPendingMessages(recipient: string): StoredMessage[] {
  const pending = pendingByRecipient.get(recipient.toLowerCase()) ?? [];
  return pending
    .map(id => messages.get(id))
    .filter((m): m is StoredMessage => m !== undefined);
}

function markDelivered(messageId: string): void {
  const msg = messages.get(messageId);
  if (msg) {
    msg.deliveredAt = Date.now();
  }
}

function notifySubscriber(address: string, data: Record<string, unknown>): boolean {
  const subscriber = subscribers.get(address.toLowerCase());
  if (subscriber && subscriber.ws.readyState === WebSocket.OPEN) {
    subscriber.ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// ============ IPFS Integration (Optional) ============

async function storeOnIPFS(content: string, ipfsUrl?: string): Promise<string | null> {
  if (!ipfsUrl) return null;
  
  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    body: content,
  }).catch(() => null);
  
  if (!response?.ok) return null;
  
  const result = await response.json() as { Hash?: string };
  return result.Hash ?? null;
}

// ============ Create Server ============

export function createRelayServer(config: NodeConfig): Hono {
  const app = new Hono();
  
  // CORS
  app.use('/*', cors());
  
  // ============ Health Check ============
  
  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      nodeId: config.nodeId ?? 'local',
      uptime: process.uptime(),
      stats: {
        messagesRelayed: totalMessagesRelayed,
        bytesRelayed: totalBytesRelayed,
        activeSubscribers: subscribers.size,
        pendingMessages: messages.size,
      },
      timestamp: Date.now(),
    });
  });
  
  // ============ Send Message ============
  
  app.post('/send', async (c) => {
    const envelope = await c.req.json<MessageEnvelope>();
    
    // Validate envelope
    if (!envelope.id || !envelope.from || !envelope.to || !envelope.encryptedContent) {
      return c.json({ success: false, error: 'Invalid envelope' }, 400);
    }
    
    // Check message size
    const messageSize = JSON.stringify(envelope).length;
    if (config.maxMessageSize && messageSize > config.maxMessageSize) {
      return c.json({ success: false, error: 'Message too large' }, 413);
    }
    
    // Generate CID
    const cid = generateCID(JSON.stringify(envelope));
    
    // Store message
    const storedMessage: StoredMessage = {
      envelope,
      cid,
      receivedAt: Date.now(),
      storedOnIPFS: false,
    };
    
    messages.set(envelope.id, storedMessage);
    addPendingMessage(envelope.to, envelope.id);
    
    // Update stats
    totalMessagesRelayed++;
    totalBytesRelayed += messageSize;
    
    // Try to store on IPFS (async, don't block)
    if (config.ipfsUrl) {
      storeOnIPFS(JSON.stringify(envelope), config.ipfsUrl)
        .then(ipfsCid => {
          if (ipfsCid) {
            storedMessage.storedOnIPFS = true;
          }
        })
        .catch(() => {});
    }
    
    // Try to deliver immediately via WebSocket
    const delivered = notifySubscriber(envelope.to, {
      type: 'message',
      data: envelope,
    });
    
    if (delivered) {
      markDelivered(envelope.id);
      
      // Notify sender of delivery
      notifySubscriber(envelope.from, {
        type: 'delivery_receipt',
        data: { messageId: envelope.id },
      });
    }
    
    return c.json({
      success: true,
      messageId: envelope.id,
      cid,
      timestamp: storedMessage.receivedAt,
      delivered,
    });
  });
  
  // ============ Get Pending Messages ============
  
  app.get('/messages/:address', (c) => {
    const address = c.req.param('address');
    const pending = getPendingMessages(address);
    
    return c.json({
      address,
      messages: pending.map(m => ({
        ...m.envelope,
        cid: m.cid,
        receivedAt: m.receivedAt,
      })),
      count: pending.length,
    });
  });
  
  // ============ Get Message by ID ============
  
  app.get('/message/:id', (c) => {
    const id = c.req.param('id');
    const message = messages.get(id);
    
    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }
    
    return c.json({
      ...message.envelope,
      cid: message.cid,
      receivedAt: message.receivedAt,
      deliveredAt: message.deliveredAt,
    });
  });
  
  // ============ Mark Message as Read ============
  
  app.post('/read/:id', (c) => {
    const id = c.req.param('id');
    const message = messages.get(id);
    
    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }
    
    // Notify sender of read receipt
    notifySubscriber(message.envelope.from, {
      type: 'read_receipt',
      data: { messageId: id, readAt: Date.now() },
    });
    
    return c.json({ success: true });
  });
  
  // ============ Stats ============
  
  app.get('/stats', (c) => {
    return c.json({
      nodeId: config.nodeId ?? 'local',
      totalMessagesRelayed,
      totalBytesRelayed,
      activeSubscribers: subscribers.size,
      pendingMessages: messages.size,
      uptime: process.uptime(),
    });
  });
  
  return app;
}

// ============ WebSocket Handler ============

export function handleWebSocket(
  ws: WebSocket,
  _request: Request
): void {
  let subscribedAddress: string | null = null;
  
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data as string) as {
      type: string;
      address?: string;
    };
    
    if (data.type === 'subscribe' && data.address) {
      subscribedAddress = data.address.toLowerCase();
      
      subscribers.set(subscribedAddress, {
        address: subscribedAddress,
        ws,
        subscribedAt: Date.now(),
      });
      
      console.log(`Subscriber connected: ${subscribedAddress}`);
      
      // Send any pending messages
      const pending = getPendingMessages(subscribedAddress);
      for (const msg of pending) {
        ws.send(JSON.stringify({
          type: 'message',
          data: msg.envelope,
        }));
        markDelivered(msg.envelope.id);
      }
      
      // Confirm subscription
      ws.send(JSON.stringify({
        type: 'subscribed',
        address: subscribedAddress,
        pendingCount: pending.length,
      }));
    }
  });
  
  ws.addEventListener('close', () => {
    if (subscribedAddress) {
      subscribers.delete(subscribedAddress);
      console.log(`Subscriber disconnected: ${subscribedAddress}`);
    }
  });
}

// ============ Start Server ============

export function startRelayServer(config: NodeConfig): void {
  const app = createRelayServer(config);
  
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: {
      message(ws, message) {
        const data = JSON.parse(message as string) as {
          type: string;
          address?: string;
        };
        
        if (data.type === 'subscribe' && data.address) {
          const address = data.address.toLowerCase();
          
          // Store WebSocket reference (simplified for Bun)
          subscribers.set(address, {
            address,
            ws: ws as unknown as WebSocket,
            subscribedAt: Date.now(),
          });
          
          console.log(`Subscriber connected: ${address}`);
          
          // Send pending messages
          const pending = getPendingMessages(address);
          for (const msg of pending) {
            ws.send(JSON.stringify({
              type: 'message',
              data: msg.envelope,
            }));
            markDelivered(msg.envelope.id);
          }
          
          ws.send(JSON.stringify({
            type: 'subscribed',
            address,
            pendingCount: pending.length,
          }));
        }
      },
      close(ws) {
        // Find and remove subscriber
        for (const [address, sub] of subscribers.entries()) {
          if (sub.ws === (ws as unknown as WebSocket)) {
            subscribers.delete(address);
            console.log(`Subscriber disconnected: ${address}`);
            break;
          }
        }
      },
    },
  });
  
  console.log(`🚀 Jeju Messaging Relay Node running at http://localhost:${server.port}`);
  console.log(`   WebSocket: ws://localhost:${server.port}/ws`);
  console.log(`   Health: http://localhost:${server.port}/health`);
}

// ============ CLI Entry Point ============

if (import.meta.main) {
  const port = parseInt(process.env.PORT ?? '3200');
  const nodeId = process.env.NODE_ID ?? `relay-${Date.now()}`;
  const ipfsUrl = process.env.IPFS_URL;
  
  startRelayServer({
    port,
    nodeId,
    ipfsUrl,
    maxMessageSize: 1024 * 1024, // 1MB
    messageRetentionDays: 7,
  });
}

