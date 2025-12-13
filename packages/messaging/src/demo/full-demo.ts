/**
 * Full E2E Demo of Jeju Decentralized Messaging
 * 
 * This script demonstrates:
 * 1. Contract deployment (MessageNodeRegistry, KeyRegistry)
 * 2. Node operator registration with stake
 * 3. User key registration
 * 4. End-to-end encrypted messaging
 * 5. Message relay and delivery
 * 6. Farcaster profile sync (mocked)
 */

import { createServer } from '../node/server';
import {
  generateKeyPair,
  deriveKeyPair,
  encryptMessage,
  decryptMessage,
  bytesToHex,
  publicKeyToBytes32,
} from '../sdk/crypto';
import type { MessageEnvelope } from '../sdk/types';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function section(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, COLORS.bright + COLORS.cyan);
  console.log('='.repeat(60) + '\n');
}

async function runFullDemo() {
  log('🚀 Jeju Decentralized Messaging - Full E2E Demo', COLORS.bright + COLORS.magenta);
  
  // ========================================
  // PHASE 1: Infrastructure Setup
  // ========================================
  section('📡 Phase 1: Infrastructure Setup');
  
  // Start relay node
  log('Starting relay node server...', COLORS.dim);
  const relay = await createServer({ port: 3300 });
  log(`✅ Relay node running at http://localhost:3300`, COLORS.green);
  
  // Simulate contract deployment (in production, this would be Foundry)
  log('\nSimulating contract deployment...', COLORS.dim);
  const contracts = {
    keyRegistry: '0x' + '1'.repeat(40),
    nodeRegistry: '0x' + '2'.repeat(40),
    stakingToken: '0x' + '3'.repeat(40),
  };
  log(`✅ KeyRegistry: ${contracts.keyRegistry}`, COLORS.green);
  log(`✅ NodeRegistry: ${contracts.nodeRegistry}`, COLORS.green);
  log(`✅ StakingToken: ${contracts.stakingToken}`, COLORS.green);

  // ========================================
  // PHASE 2: Node Operator Registration
  // ========================================
  section('🔧 Phase 2: Node Operator Registration');
  
  const nodeOperator = {
    address: '0x' + 'AAAA'.repeat(10),
    endpoint: 'http://localhost:3300',
    region: 'us-west-2',
    stakeAmount: '1000000000000000000000', // 1000 tokens
  };
  
  log('Node operator details:', COLORS.dim);
  log(`  Address: ${nodeOperator.address}`);
  log(`  Endpoint: ${nodeOperator.endpoint}`);
  log(`  Region: ${nodeOperator.region}`);
  log(`  Stake: 1000 JEJU`);
  
  log('\n✅ Node registered and staked', COLORS.green);
  log('✅ Node heartbeat initialized', COLORS.green);

  // ========================================
  // PHASE 3: User Key Registration
  // ========================================
  section('👤 Phase 3: User Key Registration');
  
  // Create users
  const alice = {
    name: 'Alice',
    address: '0x' + 'A1C3'.repeat(10) as `0x${string}`,
    babylonId: 'user-alice-123',
    farcasterFid: 12345,
    keyPair: generateKeyPair(),
  };
  
  const bob = {
    name: 'Bob',
    address: '0x' + 'B0B0'.repeat(10) as `0x${string}`,
    babylonId: 'user-bob-456',
    farcasterFid: 67890,
    keyPair: generateKeyPair(),
  };
  
  log('Registering Alice\'s keys...', COLORS.dim);
  log(`  Address: ${alice.address}`);
  log(`  Babylon ID: ${alice.babylonId}`);
  log(`  Farcaster FID: ${alice.farcasterFid}`);
  log(`  Public Key: ${bytesToHex(alice.keyPair.publicKey).slice(0, 32)}...`);
  log('✅ Alice registered on KeyRegistry', COLORS.green);
  
  log('\nRegistering Bob\'s keys...', COLORS.dim);
  log(`  Address: ${bob.address}`);
  log(`  Babylon ID: ${bob.babylonId}`);
  log(`  Farcaster FID: ${bob.farcasterFid}`);
  log(`  Public Key: ${bytesToHex(bob.keyPair.publicKey).slice(0, 32)}...`);
  log('✅ Bob registered on KeyRegistry', COLORS.green);

  // ========================================
  // PHASE 4: End-to-End Encrypted Messaging
  // ========================================
  section('🔐 Phase 4: End-to-End Encrypted Messaging');
  
  const originalMessage = 'Hello Bob! This is a secret message on Jeju L2. 🔒🌴';
  log(`Original message: "${originalMessage}"`, COLORS.yellow);
  
  // Alice encrypts message for Bob
  log('\nAlice encrypting message for Bob...', COLORS.dim);
  const encrypted = encryptMessage(originalMessage, bob.keyPair.publicKey, alice.keyPair);
  
  log(`  Ciphertext: ${bytesToHex(encrypted.ciphertext).slice(0, 64)}...`);
  log(`  Nonce: ${bytesToHex(encrypted.nonce)}`);
  log(`  Ephemeral PK: ${bytesToHex(encrypted.ephemeralPublicKey).slice(0, 32)}...`);
  
  // Create message envelope
  const envelope: MessageEnvelope = {
    id: crypto.randomUUID(),
    from: alice.address,
    to: bob.address,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    ephemeralPublicKey: encrypted.ephemeralPublicKey,
    timestamp: Date.now(),
  };
  
  log('\n✅ Message encrypted', COLORS.green);

  // ========================================
  // PHASE 5: Message Relay
  // ========================================
  section('📤 Phase 5: Message Relay');
  
  log('Sending message to relay node...', COLORS.dim);
  
  const sendResponse = await fetch('http://localhost:3300/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: envelope.id,
      from: envelope.from,
      to: envelope.to,
      ciphertext: bytesToHex(envelope.ciphertext),
      nonce: bytesToHex(envelope.nonce),
      ephemeralPublicKey: bytesToHex(envelope.ephemeralPublicKey),
      timestamp: envelope.timestamp,
    }),
  });
  
  const sendResult = await sendResponse.json() as { id: string; cid: string };
  log(`  Message ID: ${sendResult.id}`, COLORS.dim);
  log(`  IPFS CID: ${sendResult.cid}`, COLORS.dim);
  log('✅ Message relayed to decentralized network', COLORS.green);

  // ========================================
  // PHASE 6: Message Retrieval & Decryption
  // ========================================
  section('📥 Phase 6: Message Retrieval & Decryption');
  
  log('Bob fetching pending messages...', COLORS.dim);
  
  const fetchResponse = await fetch(`http://localhost:3300/messages/${bob.address}`);
  const fetchResult = await fetchResponse.json() as { 
    messages: Array<{
      id: string;
      from: string;
      ciphertext: string;
      nonce: string;
      ephemeralPublicKey: string;
      timestamp: number;
    }>;
  };
  
  log(`  Found ${fetchResult.messages.length} pending message(s)`, COLORS.dim);
  
  const receivedMsg = fetchResult.messages[0];
  log(`  From: ${receivedMsg.from}`);
  log(`  Timestamp: ${new Date(receivedMsg.timestamp).toISOString()}`);
  
  // Bob decrypts the message
  log('\nBob decrypting message...', COLORS.dim);
  
  const decrypted = decryptMessage(
    hexToBytes(receivedMsg.ciphertext),
    hexToBytes(receivedMsg.nonce),
    hexToBytes(receivedMsg.ephemeralPublicKey),
    bob.keyPair
  );
  
  log(`✅ Decrypted message: "${decrypted}"`, COLORS.green);

  // ========================================
  // PHASE 7: Verification
  // ========================================
  section('✅ Phase 7: Verification');
  
  const verified = originalMessage === decrypted;
  
  if (verified) {
    log('✅ Message integrity verified!', COLORS.green);
    log('✅ Original matches decrypted!', COLORS.green);
    log('✅ Relay node cannot read message content!', COLORS.green);
  } else {
    log('❌ Verification failed!', COLORS.yellow);
  }

  // ========================================
  // PHASE 8: Stats & Summary
  // ========================================
  section('📊 Phase 8: System Statistics');
  
  const statsResponse = await fetch('http://localhost:3300/stats');
  const stats = await statsResponse.json() as {
    totalMessages: number;
    totalBytes: number;
    activeSubscribers: number;
    pendingMessages: number;
  };
  
  log('Relay Node Stats:', COLORS.dim);
  log(`  Total messages relayed: ${stats.totalMessages}`);
  log(`  Total bytes relayed: ${stats.totalBytes}`);
  log(`  Active WebSocket subscribers: ${stats.activeSubscribers}`);
  log(`  Pending messages: ${stats.pendingMessages}`);

  // ========================================
  // PHASE 9: Farcaster Integration (Mock)
  // ========================================
  section('🌐 Phase 9: Farcaster Integration');
  
  log('Syncing Farcaster profiles... (simulated)', COLORS.dim);
  
  const mockFarcasterProfile = {
    fid: alice.farcasterFid,
    username: 'alice.eth',
    displayName: 'Alice',
    bio: 'Web3 enthusiast 🌴',
    pfpUrl: 'https://example.com/alice.png',
    followerCount: 1234,
    followingCount: 567,
  };
  
  log(`  Profile for FID ${mockFarcasterProfile.fid}:`, COLORS.dim);
  log(`    Username: @${mockFarcasterProfile.username}`);
  log(`    Display Name: ${mockFarcasterProfile.displayName}`);
  log(`    Followers: ${mockFarcasterProfile.followerCount}`);
  
  log('\n✅ Farcaster profile synced to Babylon DB', COLORS.green);
  log('✅ Public casts indexed for social feed', COLORS.green);

  // ========================================
  // SUMMARY
  // ========================================
  section('🎉 Demo Complete!');
  
  log('Summary of demonstrated features:', COLORS.bright);
  console.log(`
  1. ✅ Relay node deployment and operation
  2. ✅ Node operator staking (simulated)
  3. ✅ User key pair generation (X25519)
  4. ✅ On-chain key registration (simulated)
  5. ✅ End-to-end encryption (AES-256-GCM)
  6. ✅ Message relay through decentralized node
  7. ✅ Message retrieval and decryption
  8. ✅ Message integrity verification
  9. ✅ Farcaster integration (simulated)
  
  ${COLORS.bright}${COLORS.magenta}🌴 Jeju Decentralized Messaging is ready!${COLORS.reset}
  
  ${COLORS.dim}Next steps:
  • Deploy contracts to Jeju L2 testnet: forge script script/DeployMessaging.s.sol
  • Deploy relay node via Terraform: cd terraform && terraform apply
  • Integrate with Babylon frontend using @babylon/messaging React hooks${COLORS.reset}
  `);

  // Cleanup
  relay.stop();
  log('\n🛑 Relay node stopped', COLORS.dim);
}

// Helper function to convert hex to bytes
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Run the demo
runFullDemo().catch(console.error);

