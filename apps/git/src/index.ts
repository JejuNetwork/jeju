/**
 * JejuGit Server Entry Point
 */

import { createJejuGitRouter } from './server';
import { serve } from 'bun';

const port = parseInt(process.env.GIT_PORT ?? '4020', 10);

const app = createJejuGitRouter({
  storageBackend: 'hybrid',
  ipfsUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
  arweaveUrl: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
  privateKey: process.env.PRIVATE_KEY,
  federationEnabled: process.env.FEDERATION_ENABLED === 'true',
  federationUrl: process.env.FEDERATION_URL,
});

console.log(`[JejuGit] Starting server on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`[JejuGit] Server running at http://localhost:${port}`);
console.log(`[JejuGit] Clone repos with: git clone http://localhost:${port}/<owner>/<repo>.git`);

export { createJejuGitRouter, createJejuGitServer } from './server';
export type { Repository, GitUser, Issue, PullRequest } from './server';
