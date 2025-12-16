#!/usr/bin/env bun
/**
 * DWS Self-Hosting Script
 * 
 * Uploads DWS itself to DWS storage and creates a self-hosted Git repository.
 * This enables true decentralization where DWS code is hosted on DWS.
 * 
 * Usage:
 *   bun run scripts/self-host.ts
 * 
 * Environment:
 *   DWS_BASE_URL - DWS server URL (default: http://localhost:4030)
 *   DEPLOYER_ADDRESS - Address to own the repo
 */

import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

const DWS_URL = process.env.DWS_BASE_URL || 'http://localhost:4030';
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

interface UploadResult {
  cid: string;
  url: string;
  backend: string;
}

async function uploadFile(content: Buffer, filename: string): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', new Blob([content]), filename);
  
  const response = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`);
  }
  
  return response.json() as Promise<UploadResult>;
}

async function uploadDirectory(dir: string, prefix: string = ''): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    
    // Skip node_modules and hidden files
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    
    if (entry.isDirectory()) {
      const subResults = await uploadDirectory(fullPath, relativePath);
      for (const [path, cid] of subResults) {
        results.set(path, cid);
      }
    } else if (entry.isFile()) {
      const file = Bun.file(fullPath);
      const content = Buffer.from(await file.arrayBuffer());
      const result = await uploadFile(content, entry.name);
      results.set(relativePath, result.cid);
      console.log(`  Uploaded: ${relativePath} -> ${result.cid}`);
    }
  }
  
  return results;
}

async function createRepository(name: string, description: string): Promise<{ repoId: string; cloneUrl: string }> {
  const response = await fetch(`${DWS_URL}/git/repos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': DEPLOYER_ADDRESS,
    },
    body: JSON.stringify({
      name,
      description,
      visibility: 'public',
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create repo: ${JSON.stringify(error)}`);
  }
  
  return response.json() as Promise<{ repoId: string; cloneUrl: string }>;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DWS Self-Hosting');
  console.log('='.repeat(60));
  console.log(`DWS Server: ${DWS_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);
  console.log();
  
  // Check DWS is healthy
  const healthResponse = await fetch(`${DWS_URL}/health`);
  if (!healthResponse.ok) {
    throw new Error('DWS server is not healthy');
  }
  const health = await healthResponse.json();
  console.log(`DWS Status: ${health.status}`);
  console.log();
  
  // 1. Upload frontend to IPFS
  console.log('1. Uploading frontend to IPFS...');
  const frontendDir = join(import.meta.dir, '../frontend');
  const frontendFiles = await uploadDirectory(frontendDir);
  console.log(`   Uploaded ${frontendFiles.size} files`);
  
  // Create directory CID by uploading as folder
  // For now, we'll use the index.html CID as the frontend CID
  const indexCid = frontendFiles.get('index.html');
  console.log(`   Frontend index CID: ${indexCid}`);
  console.log();
  
  // 2. Create DWS repository on DWS Git
  console.log('2. Creating DWS repository...');
  const { repoId, cloneUrl } = await createRepository(
    'dws',
    'Decentralized Web Services - Storage, Compute, CDN, Git, and NPM'
  );
  console.log(`   Repository ID: ${repoId}`);
  console.log(`   Clone URL: ${cloneUrl}`);
  console.log();
  
  // 3. Upload source code
  console.log('3. Uploading source code...');
  const srcDir = join(import.meta.dir, '../src');
  const srcFiles = await uploadDirectory(srcDir, 'src');
  console.log(`   Uploaded ${srcFiles.size} source files`);
  console.log();
  
  // 4. Summary
  console.log('='.repeat(60));
  console.log('Self-Hosting Complete');
  console.log('='.repeat(60));
  console.log();
  console.log('To run DWS with decentralized frontend:');
  console.log(`  DWS_FRONTEND_CID=${indexCid} bun run dev`);
  console.log();
  console.log('To clone DWS from DWS:');
  console.log(`  git clone ${cloneUrl}`);
  console.log();
  console.log('Environment variables for production:');
  console.log(`  DWS_FRONTEND_CID=${indexCid}`);
  console.log(`  DWS_P2P_ENABLED=true`);
  console.log();
}

main().catch(console.error);

