/**
 * End-to-End Tests for Jeju Messaging
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  decryptMessageToString,
  serializeEncryptedMessage,
  deserializeEncryptedMessage,
  publicKeyToHex,
  publicKeyToBytes32,
  bytes32ToPublicKey,
  deriveKeyPairFromWallet,
  publicKeysEqual,
  type MessageEnvelope,
} from '../sdk';
import { createRelayServer } from '../node';

// ============ Crypto Tests ============

describe('Crypto', () => {
  test('generates valid key pairs', () => {
    const keyPair = generateKeyPair();
    
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(32);
    expect(keyPair.privateKey.length).toBe(32);
  });
  
  test('encrypts and decrypts messages', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const message = 'Hello, Bob!';
    
    // Alice encrypts for Bob
    const encrypted = encryptMessage(message, bob.publicKey, alice.privateKey);
    
    expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
    expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
    expect(encrypted.ephemeralPublicKey).toBeInstanceOf(Uint8Array);
    expect(encrypted.nonce.length).toBe(12);
    expect(encrypted.ephemeralPublicKey.length).toBe(32);
    
    // Bob decrypts
    const decrypted = decryptMessageToString(encrypted, bob.privateKey);
    expect(decrypted).toBe(message);
  });
  
  test('serializes and deserializes encrypted messages', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const message = 'Test serialization';
    const encrypted = encryptMessage(message, bob.publicKey);
    
    // Serialize
    const serialized = serializeEncryptedMessage(encrypted);
    expect(typeof serialized.ciphertext).toBe('string');
    expect(typeof serialized.nonce).toBe('string');
    expect(typeof serialized.ephemeralPublicKey).toBe('string');
    
    // Deserialize
    const deserialized = deserializeEncryptedMessage(serialized);
    expect(deserialized.ciphertext).toEqual(encrypted.ciphertext);
    expect(deserialized.nonce).toEqual(encrypted.nonce);
    expect(deserialized.ephemeralPublicKey).toEqual(encrypted.ephemeralPublicKey);
    
    // Verify decryption still works
    const decrypted = decryptMessageToString(deserialized, bob.privateKey);
    expect(decrypted).toBe(message);
  });
  
  test('handles public key conversions', () => {
    const keyPair = generateKeyPair();
    
    // To hex and back
    const hex = publicKeyToHex(keyPair.publicKey);
    expect(typeof hex).toBe('string');
    expect(hex.length).toBe(64);
    
    // To bytes32 and back
    const bytes32 = publicKeyToBytes32(keyPair.publicKey);
    expect(bytes32.startsWith('0x')).toBe(true);
    expect(bytes32.length).toBe(66);
    
    const recovered = bytes32ToPublicKey(bytes32);
    expect(publicKeysEqual(recovered, keyPair.publicKey)).toBe(true);
  });
  
  test('derives deterministic keys from wallet signature', () => {
    const address = '0x1234567890123456789012345678901234567890';
    const signature = '0xabcdef123456...'; // Simulated signature
    
    const keyPair1 = deriveKeyPairFromWallet(address, signature);
    const keyPair2 = deriveKeyPairFromWallet(address, signature);
    
    // Same inputs should produce same keys
    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true);
    
    // Different signature should produce different keys
    const keyPair3 = deriveKeyPairFromWallet(address, 'different-signature');
    expect(publicKeysEqual(keyPair1.publicKey, keyPair3.publicKey)).toBe(false);
  });
  
  test('handles unicode and emoji in messages', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const messages = [
      '你好世界',
      '🔐🎉🚀',
      'Héllo Wörld!',
      'مرحبا بالعالم',
    ];
    
    for (const message of messages) {
      const encrypted = encryptMessage(message, bob.publicKey);
      const decrypted = decryptMessageToString(encrypted, bob.privateKey);
      expect(decrypted).toBe(message);
    }
  });
  
  test('handles large messages', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    // 1KB message
    const message = 'x'.repeat(1024);
    
    const encrypted = encryptMessage(message, bob.publicKey);
    const decrypted = decryptMessageToString(encrypted, bob.privateKey);
    expect(decrypted).toBe(message);
  });
});

// ============ Relay Server Tests ============

describe('Relay Server', () => {
  let server: ReturnType<typeof Bun.serve>;
  const PORT = 3201;
  const BASE_URL = `http://localhost:${PORT}`;
  
  beforeAll(() => {
    const app = createRelayServer({
      port: PORT,
      nodeId: 'test-node',
    });
    
    server = Bun.serve({
      port: PORT,
      fetch: app.fetch,
    });
  });
  
  afterAll(() => {
    server.stop();
  });
  
  test('health check returns node info', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.ok).toBe(true);
    
    const data = await response.json() as {
      status: string;
      nodeId: string;
    };
    expect(data.status).toBe('healthy');
    expect(data.nodeId).toBe('test-node');
  });
  
  test('accepts and stores messages', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const aliceAddress = '0x' + publicKeyToHex(alice.publicKey).slice(0, 40);
    const bobAddress = '0x' + publicKeyToHex(bob.publicKey).slice(0, 40);
    
    const message = 'Test message';
    const encrypted = encryptMessage(message, bob.publicKey);
    
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      from: aliceAddress,
      to: bobAddress,
      encryptedContent: serializeEncryptedMessage(encrypted),
      timestamp: Date.now(),
    };
    
    const response = await fetch(`${BASE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    
    expect(response.ok).toBe(true);
    
    const result = await response.json() as {
      success: boolean;
      messageId: string;
      cid: string;
    };
    expect(result.success).toBe(true);
    expect(result.messageId).toBe(envelope.id);
    expect(result.cid).toBeDefined();
  });
  
  test('retrieves pending messages for recipient', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const aliceAddress = '0x' + publicKeyToHex(alice.publicKey).slice(0, 40);
    const bobAddress = '0x' + publicKeyToHex(bob.publicKey).slice(0, 40);
    
    // Send a message
    const message = 'Pending message test';
    const encrypted = encryptMessage(message, bob.publicKey);
    
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      from: aliceAddress,
      to: bobAddress,
      encryptedContent: serializeEncryptedMessage(encrypted),
      timestamp: Date.now(),
    };
    
    await fetch(`${BASE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    
    // Fetch pending messages
    const response = await fetch(`${BASE_URL}/messages/${bobAddress}`);
    expect(response.ok).toBe(true);
    
    const result = await response.json() as {
      messages: MessageEnvelope[];
      count: number;
    };
    expect(result.count).toBeGreaterThan(0);
    
    // Verify we can decrypt
    const receivedEnvelope = result.messages.find(m => m.id === envelope.id);
    expect(receivedEnvelope).toBeDefined();
    
    const encryptedData = deserializeEncryptedMessage(receivedEnvelope!.encryptedContent);
    const decrypted = decryptMessageToString(encryptedData, bob.privateKey);
    expect(decrypted).toBe(message);
  });
  
  test('rejects invalid envelopes', async () => {
    const response = await fetch(`${BASE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'envelope' }),
    });
    
    expect(response.status).toBe(400);
  });
  
  test('returns stats', async () => {
    const response = await fetch(`${BASE_URL}/stats`);
    expect(response.ok).toBe(true);
    
    const stats = await response.json() as {
      nodeId: string;
      totalMessagesRelayed: number;
    };
    expect(stats.nodeId).toBe('test-node');
    expect(typeof stats.totalMessagesRelayed).toBe('number');
  });
});

// ============ Full E2E Flow Test ============

describe('E2E Flow', () => {
  let server: ReturnType<typeof Bun.serve>;
  const PORT = 3202;
  const BASE_URL = `http://localhost:${PORT}`;
  
  beforeAll(() => {
    const app = createRelayServer({ port: PORT, nodeId: 'e2e-test' });
    server = Bun.serve({ port: PORT, fetch: app.fetch });
  });
  
  afterAll(() => {
    server.stop();
  });
  
  test('complete message flow: encrypt -> send -> receive -> decrypt', async () => {
    // Setup users
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const aliceAddress = '0xAlice' + publicKeyToHex(alice.publicKey).slice(0, 34);
    const bobAddress = '0xBob' + publicKeyToHex(bob.publicKey).slice(0, 36);
    
    // Alice sends encrypted message to Bob
    const originalMessage = 'Hello from Alice to Bob! 🔐';
    const encrypted = encryptMessage(originalMessage, bob.publicKey, alice.privateKey);
    
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      from: aliceAddress,
      to: bobAddress,
      encryptedContent: serializeEncryptedMessage(encrypted),
      timestamp: Date.now(),
    };
    
    // Send
    const sendResponse = await fetch(`${BASE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    expect(sendResponse.ok).toBe(true);
    
    // Bob retrieves messages
    const fetchResponse = await fetch(`${BASE_URL}/messages/${bobAddress}`);
    const { messages } = await fetchResponse.json() as { messages: MessageEnvelope[] };
    
    // Find our message
    const received = messages.find(m => m.id === envelope.id);
    expect(received).toBeDefined();
    expect(received!.from).toBe(aliceAddress);
    
    // Bob decrypts
    const encryptedData = deserializeEncryptedMessage(received!.encryptedContent);
    const decrypted = decryptMessageToString(encryptedData, bob.privateKey);
    
    expect(decrypted).toBe(originalMessage);
  });
  
  test('multiple messages between users', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    
    const aliceAddress = '0xMultiAlice' + publicKeyToHex(alice.publicKey).slice(0, 30);
    const bobAddress = '0xMultiBob' + publicKeyToHex(bob.publicKey).slice(0, 32);
    
    const messagesToSend = [
      'First message',
      'Second message',
      'Third message',
    ];
    
    // Send all messages
    for (const msg of messagesToSend) {
      const encrypted = encryptMessage(msg, bob.publicKey);
      const envelope: MessageEnvelope = {
        id: crypto.randomUUID(),
        from: aliceAddress,
        to: bobAddress,
        encryptedContent: serializeEncryptedMessage(encrypted),
        timestamp: Date.now(),
      };
      
      await fetch(`${BASE_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });
    }
    
    // Fetch all
    const response = await fetch(`${BASE_URL}/messages/${bobAddress}`);
    const { messages, count } = await response.json() as {
      messages: MessageEnvelope[];
      count: number;
    };
    
    expect(count).toBeGreaterThanOrEqual(messagesToSend.length);
    
    // Decrypt all from Alice
    const fromAlice = messages.filter(m => m.from === aliceAddress);
    const decrypted = fromAlice.map(m => {
      const enc = deserializeEncryptedMessage(m.encryptedContent);
      return decryptMessageToString(enc, bob.privateKey);
    });
    
    // All original messages should be present
    for (const original of messagesToSend) {
      expect(decrypted).toContain(original);
    }
  });
});

