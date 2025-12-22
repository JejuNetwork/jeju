/**
 * Network Messaging Relay Node Server
 * 
 * Handles message routing, storage, and delivery for the decentralized
 * messaging network.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { 
  MessageEnvelopeSchema, 
  WebSocketSubscribeSchema, 
  IPFSAddResponseSchema,
  type MessageEnvelope,
  type NodeConfig,
} from '../schemas';

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

/** Message types sent via WebSocket to subscribers */
interface WebSocketNotification {
  type: 'message' | 'delivery_receipt' | 'read_receipt' | 'subscribed' | 'error';
  data?: MessageEnvelope | { messageId: string } | { messageId: string; readAt: number };
  address?: string;
  pendingCount?: number;
  error?: string;
  details?: { message: string; path?: (string | number)[] }[];
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
  const normalizedRecipient = recipient.toLowerCase();
  const existing = pendingByRecipient.get(normalizedRecipient);
  if (existing) {
    existing.push(messageId);
  } else {
    pendingByRecipient.set(normalizedRecipient, [messageId]);
  }
}

function getPendingMessages(recipient: string): StoredMessage[] {
  const normalizedRecipient = recipient.toLowerCase();
  const pending = pendingByRecipient.get(normalizedRecipient);
  if (!pending) {
    return [];
  }
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

function notifySubscriber(address: string, notification: WebSocketNotification): boolean {
  const subscriber = subscribers.get(address.toLowerCase());
  if (subscriber && subscriber.ws.readyState === WebSocket.OPEN) {
    subscriber.ws.send(JSON.stringify(notification));
    return true;
  }
  return false;
}

// ============ IPFS Integration (Optional) ============

/**
 * Store content on IPFS. Returns CID on success, null if IPFS is not configured.
 * Throws if IPFS is configured but storage fails.
 */
async function storeOnIPFS(content: string, ipfsUrl: string): Promise<string> {
  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    body: content,
  });
  
  if (!response.ok) {
    throw new Error(`IPFS storage failed: ${response.status} ${response.statusText}`);
  }
  
  const result = IPFSAddResponseSchema.parse(await response.json());
  return result.Hash;
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
      nodeId: config.nodeId,
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
    const body = await c.req.json();
    
    // Validate envelope with Zod schema
    const parseResult = MessageEnvelopeSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid envelope', 
        details: parseResult.error.issues 
      }, 400);
    }
    
    const envelope = parseResult.data;
    
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
    
    // Store on IPFS if configured (async, log failures)
    if (config.ipfsUrl) {
      storeOnIPFS(JSON.stringify(envelope), config.ipfsUrl)
        .then(() => {
          storedMessage.storedOnIPFS = true;
        })
        .catch((err: Error) => {
          console.error(`IPFS storage failed for message ${envelope.id}:`, err.message);
        });
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
      nodeId: config.nodeId,
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

interface WebSocketLike {
  send: (data: string) => void;
  close: () => void;
  readyState: number;
}

/**
 * Process a subscription message and set up the subscriber
 * Returns the subscribed address or null if invalid
 */
function processSubscription(
  rawMessage: string,
  ws: WebSocketLike,
  onSubscribe: (address: string) => void
): string | null {
  const parseResult = WebSocketSubscribeSchema.safeParse(JSON.parse(rawMessage));
  
  if (!parseResult.success) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Invalid message format',
      details: parseResult.error.issues,
    }));
    return null;
  }
  
  const address = parseResult.data.address.toLowerCase();
  
  subscribers.set(address, {
    address,
    ws: ws as WebSocket,
    subscribedAt: Date.now(),
  });
  
  onSubscribe(address);
  
  // Send any pending messages
  const pending = getPendingMessages(address);
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
    address,
    pendingCount: pending.length,
  }));
  
  return address;
}

export function handleWebSocket(
  ws: WebSocket,
  _request: Request
): void {
  let subscribedAddress: string | null = null;
  
  ws.addEventListener('message', (event) => {
    subscribedAddress = processSubscription(
      event.data as string,
      ws,
      () => {}
    );
  });
  
  ws.addEventListener('close', () => {
    if (subscribedAddress) {
      subscribers.delete(subscribedAddress);
    }
  });
}

// Track Bun websocket instances separately for the close handler
const bunWsToAddress = new WeakMap<object, string>();

// ============ Start Server ============

export function startRelayServer(config: NodeConfig): void {
  const app = createRelayServer(config);
  
  Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: {
      message(ws, message) {
        // Create a WebSocket-like wrapper for the shared handler
        const wsWrapper: WebSocketLike = {
          send: (d: string) => { ws.send(d); },
          close: () => { ws.close(); },
          readyState: WebSocket.OPEN,
        };
        
        const address = processSubscription(
          message as string,
          wsWrapper,
          (addr) => { bunWsToAddress.set(ws, addr); }
        );
        
        if (address) {
          // Update subscriber with wrapper
          subscribers.set(address, {
            address,
            ws: wsWrapper as WebSocket,
            subscribedAt: Date.now(),
          });
        }
      },
      close(ws) {
        const address = bunWsToAddress.get(ws);
        if (address) {
          subscribers.delete(address);
          bunWsToAddress.delete(ws);
        }
      },
    },
  });
}

// ============ CLI Entry Point ============

if (import.meta.main) {
  const portEnv = process.env.PORT;
  const nodeIdEnv = process.env.NODE_ID;
  const ipfsUrl = process.env.IPFS_URL;
  
  if (!portEnv) {
    throw new Error('PORT environment variable is required');
  }
  
  if (!nodeIdEnv) {
    throw new Error('NODE_ID environment variable is required');
  }
  
  const port = parseInt(portEnv, 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portEnv}`);
  }
  
  startRelayServer({
    port,
    nodeId: nodeIdEnv,
    ipfsUrl,
    maxMessageSize: 1024 * 1024, // 1MB
    messageRetentionDays: 7,
  });
}

