/**
 * Network Compute Node
 *
 * A decentralized compute marketplace node supporting:
 * - Standard inference API
 * - SSH access for compute rentals
 * - Docker container management
 * - ERC-8004 registration
 *
 * Default port: 4007 (COMPUTE_PORT env var)
 */

export * from './attestation';
export * from './hardware';
export * from './inference';
export * from './server';
export * from './types';
export * from './rental';

// Run as standalone server
if (import.meta.main) {
  const { startComputeNode } = await import('./server');
  await startComputeNode();
}
