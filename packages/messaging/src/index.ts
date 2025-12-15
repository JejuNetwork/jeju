/**
 * @jeju/messaging
 * 
 * Decentralized private messaging protocol for Network L2
 * 
 * Features:
 * - End-to-end encryption (X25519 + AES-256-GCM)
 * - Decentralized relay network with economic incentives
 * - On-chain key registry for public keys
 * - IPFS storage for message persistence
 * - x402 micropayments for message delivery
 * 
 * @example
 * ```typescript
 * import { createMessagingClient } from '@jeju/messaging';
 * 
 * const client = createMessagingClient({
 *   rpcUrl: 'http://localhost:9545',
 *   address: '0x...',
 *   relayUrl: 'http://localhost:3200',
 * });
 * 
 * // Initialize with wallet signature
 * const signature = await wallet.signMessage(client.getKeyDerivationMessage());
 * await client.initialize(signature);
 * 
 * // Send encrypted message
 * await client.sendMessage({
 *   to: '0xRecipient...',
 *   content: 'Hello, private world!',
 * });
 * 
 * // Listen for incoming messages
 * client.onMessage((event) => {
 *   if (event.type === 'message:new') {
 *     console.log('New message:', event.data.content);
 *   }
 * });
 * ```
 * 
 * For relay node functionality, import from '@jeju/messaging/node' (Node.js only)
 */

// Re-export SDK (browser-compatible)
export * from './sdk';

// Note: Node-only exports (relay server) available via '@jeju/messaging/node'

