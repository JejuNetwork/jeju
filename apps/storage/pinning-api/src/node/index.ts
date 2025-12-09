/**
 * Jeju Storage Node
 *
 * A decentralized storage marketplace node supporting:
 * - IPFS pinning and retrieval
 * - x402 micropayments
 * - ERC-8004 registration
 * - Multiple storage backends
 *
 * Default port: 3100 (STORAGE_PORT env var)
 */

export * from './server';

// Run as standalone server
if (import.meta.main) {
  const { startStorageNode } = await import('./server');
  await startStorageNode();
}

