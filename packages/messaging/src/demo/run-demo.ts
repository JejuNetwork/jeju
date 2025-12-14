/**
 * End-to-End Demo: Jeju Decentralized Messaging
 * 
 * This demo shows the full flow:
 * 1. Start a relay node
 * 2. Alice generates keys and registers on-chain (simulated)
 * 3. Bob generates keys and registers on-chain (simulated)
 * 4. Alice sends encrypted message to Bob
 * 5. Bob receives and decrypts message
 * 6. Verify message integrity
 */

import {
  generateKeyPair,
  encryptMessage,
  decryptMessageToString,
  serializeEncryptedMessage,
  deserializeEncryptedMessage,
  publicKeyToHex,
  type MessageEnvelope,
} from '../sdk';
import { startRelayServer } from '../node';

// ============ Configuration ============

const RELAY_PORT = 3200;
const RELAY_URL = `http://localhost:${RELAY_PORT}`;

// ============ Demo Participants ============

interface DemoUser {
  name: string;
  address: string;
  keyPair: ReturnType<typeof generateKeyPair>;
}

function createDemoUser(name: string): DemoUser {
  const keyPair = generateKeyPair();
  // Simulate Ethereum address
  const address = `0x${publicKeyToHex(keyPair.publicKey).slice(0, 40)}`;
  
  return { name, address, keyPair };
}

// ============ Demo Flow ============

async function runDemo(): Promise<void> {
  console.log('🔐 Jeju Decentralized Messaging - E2E Demo\n');
  console.log('='.repeat(50));
  
  // Step 1: Start relay node
  console.log('\n📡 Step 1: Starting relay node...');
  startRelayServer({
    port: RELAY_PORT,
    nodeId: 'demo-relay-1',
  });
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Step 2: Create demo users
  console.log('\n👤 Step 2: Creating demo users...');
  
  const alice = createDemoUser('Alice');
  const bob = createDemoUser('Bob');
  
  console.log(`   Alice address: ${alice.address}`);
  console.log(`   Alice public key: ${publicKeyToHex(alice.keyPair.publicKey).slice(0, 32)}...`);
  console.log(`   Bob address: ${bob.address}`);
  console.log(`   Bob public key: ${publicKeyToHex(bob.keyPair.publicKey).slice(0, 32)}...`);
  
  // Step 3: Simulate on-chain key registration
  console.log('\n📝 Step 3: Simulating on-chain key registration...');
  console.log('   (In production, this would write to KeyRegistry contract)');
  
  // Key registry simulation (in-memory)
  const keyRegistry = new Map<string, Uint8Array>();
  keyRegistry.set(alice.address.toLowerCase(), alice.keyPair.publicKey);
  keyRegistry.set(bob.address.toLowerCase(), bob.keyPair.publicKey);
  
  console.log('   ✅ Alice key registered');
  console.log('   ✅ Bob key registered');
  
  // Step 4: Alice sends encrypted message to Bob
  console.log('\n📤 Step 4: Alice sending encrypted message to Bob...');
  
  const originalMessage = 'Hello Bob! This is a secret message from Alice. 🔒';
  console.log(`   Original message: "${originalMessage}"`);
  
  // Get Bob's public key from registry
  const bobPublicKey = keyRegistry.get(bob.address.toLowerCase());
  if (!bobPublicKey) {
    throw new Error('Bob public key not found');
  }
  
  // Encrypt message
  const encrypted = encryptMessage(
    originalMessage,
    bobPublicKey,
    alice.keyPair.privateKey
  );
  
  console.log(`   Encrypted ciphertext: ${Buffer.from(encrypted.ciphertext).toString('hex').slice(0, 64)}...`);
  console.log(`   Ephemeral public key: ${publicKeyToHex(encrypted.ephemeralPublicKey).slice(0, 32)}...`);
  
  // Create envelope
  const envelope: MessageEnvelope = {
    id: crypto.randomUUID(),
    from: alice.address,
    to: bob.address,
    encryptedContent: serializeEncryptedMessage(encrypted),
    timestamp: Date.now(),
  };
  
  // Send to relay
  console.log('\n   Sending to relay node...');
  const response = await fetch(`${RELAY_URL}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  
  const sendResult = await response.json() as { 
    success: boolean; 
    messageId: string;
    cid: string;
  };
  console.log(`   ✅ Message sent! ID: ${sendResult.messageId}`);
  console.log(`   CID: ${sendResult.cid}`);
  
  // Step 5: Bob fetches and decrypts message
  console.log('\n📥 Step 5: Bob fetching and decrypting message...');
  
  // Fetch pending messages
  const messagesResponse = await fetch(`${RELAY_URL}/messages/${bob.address}`);
  const messagesResult = await messagesResponse.json() as {
    messages: MessageEnvelope[];
    count: number;
  };
  
  console.log(`   Found ${messagesResult.count} pending message(s)`);
  
  if (messagesResult.count === 0) {
    console.log('   ❌ No messages found!');
    process.exit(1);
  }
  
  const receivedEnvelope = messagesResult.messages[0];
  console.log(`   Message from: ${receivedEnvelope.from}`);
  console.log(`   Timestamp: ${new Date(receivedEnvelope.timestamp).toISOString()}`);
  
  // Decrypt
  const encryptedMessage = deserializeEncryptedMessage(receivedEnvelope.encryptedContent);
  const decryptedMessage = decryptMessageToString(
    encryptedMessage,
    bob.keyPair.privateKey
  );
  
  console.log(`   ✅ Decrypted message: "${decryptedMessage}"`);
  
  // Step 6: Verify
  console.log('\n✅ Step 6: Verification...');
  
  if (decryptedMessage === originalMessage) {
    console.log('   ✅ Message integrity verified!');
    console.log('   ✅ Original matches decrypted!');
  } else {
    console.log('   ❌ Message mismatch!');
    console.log(`   Original: "${originalMessage}"`);
    console.log(`   Decrypted: "${decryptedMessage}"`);
    process.exit(1);
  }
  
  // Step 7: Check relay stats
  console.log('\n📊 Step 7: Relay node stats...');
  
  const statsResponse = await fetch(`${RELAY_URL}/stats`);
  const stats = await statsResponse.json() as {
    totalMessagesRelayed: number;
    totalBytesRelayed: number;
    activeSubscribers: number;
    pendingMessages: number;
  };
  
  console.log(`   Total messages relayed: ${stats.totalMessagesRelayed}`);
  console.log(`   Total bytes relayed: ${stats.totalBytesRelayed}`);
  console.log(`   Active subscribers: ${stats.activeSubscribers}`);
  console.log(`   Pending messages: ${stats.pendingMessages}`);
  
  // Done
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Demo completed successfully!');
  console.log('\nKey takeaways:');
  console.log('  • Messages are end-to-end encrypted');
  console.log('  • Only the recipient can decrypt');
  console.log('  • Relay node cannot read message content');
  console.log('  • Keys are stored on-chain for discovery');
  console.log('  • Messages are stored with IPFS CIDs');
  
  // Keep server running for manual testing
  console.log('\n🔄 Relay node running at ' + RELAY_URL);
  console.log('   Press Ctrl+C to stop.');
}

// ============ Run ============

runDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});

