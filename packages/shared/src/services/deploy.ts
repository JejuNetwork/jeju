/**
 * Deployment Utilities
 * 
 * Helpers for deploying dApps to the decentralized network.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type { Address } from 'viem';
import { getStorageServiceFromEnv } from './storage';
import { getJNSServiceFromEnv, setupDAppJNS } from './jns';
import { getCronServiceFromEnv } from './cron';

// Manifest schema for validation
const JejuManifestSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  ports: z.object({
    main: z.number().optional(),
  }).optional(),
});

export interface DeployConfig {
  appDir: string;
  jnsName: string;
  owner?: Address;
  privateKey?: string;
  network?: 'localnet' | 'testnet' | 'mainnet';
  buildDir?: string;
  backendUrl?: string;
  cronJobs?: Array<{
    name: string;
    schedule: string;
    webhook: string;
  }>;
}

export interface DeployResult {
  jnsName: string;
  frontendCid: string;
  backendUrl: string;
  a2aEndpoint: string;
  mcpEndpoint: string;
  cronJobs: string[];
}

export async function deployApp(config: DeployConfig): Promise<DeployResult> {
  console.log(`\n🚀 Deploying ${config.jnsName}...\n`);

  // Get wallet
  const wallet = await getWallet(config);
  const owner = wallet.address as Address;
  console.log(`Deployer: ${owner}`);

  // Build frontend if needed
  const buildDir = config.buildDir || join(config.appDir, 'dist');
  if (!existsSync(buildDir)) {
    console.log('\n📦 Building frontend...');
    await buildFrontend(config.appDir);
  }

  // Deploy frontend to IPFS
  console.log('\n📤 Uploading frontend to IPFS...');
  const frontendCid = await deployFrontendToIPFS(buildDir, owner);
  console.log(`   CID: ${frontendCid}`);

  // Get backend URL
  const backendUrl = config.backendUrl || `http://localhost:${getPortFromManifest(config.appDir)}`;

  // Setup JNS
  console.log('\n🌐 Configuring JNS...');
  const jns = getJNSServiceFromEnv();
  await setupDAppJNS(jns, owner, {
    name: config.jnsName,
    backendUrl,
    frontendCid,
  });
  console.log(`   Name: ${config.jnsName}`);

  // Setup cron jobs
  const cronJobIds: string[] = [];
  if (config.cronJobs && config.cronJobs.length > 0) {
    console.log('\n⏰ Setting up cron jobs...');
    const cron = getCronServiceFromEnv();
    
    for (const job of config.cronJobs) {
      const cronJob = await cron.register({
        name: job.name,
        type: 'cron',
        expression: job.schedule,
        webhook: job.webhook,
        owner,
      });
      cronJobIds.push(cronJob.id);
      console.log(`   ${job.name}: ${cronJob.id}`);
    }
  }

  const result: DeployResult = {
    jnsName: config.jnsName,
    frontendCid,
    backendUrl,
    a2aEndpoint: `${backendUrl}/a2a`,
    mcpEndpoint: `${backendUrl}/mcp`,
    cronJobs: cronJobIds,
  };

  console.log('\n✅ Deployment complete!');
  console.log('═══════════════════════════════════════');
  console.log(`JNS:      ${result.jnsName}`);
  console.log(`Frontend: ipfs://${result.frontendCid}`);
  console.log(`Backend:  ${result.backendUrl}`);
  console.log(`A2A:      ${result.a2aEndpoint}`);
  console.log(`MCP:      ${result.mcpEndpoint}`);
  console.log('═══════════════════════════════════════\n');

  return result;
}

async function getWallet(config: DeployConfig): Promise<ReturnType<typeof privateKeyToAccount>> {
  const privateKey = config.privateKey || process.env.DEPLOYER_PRIVATE_KEY;
  
  if (privateKey) {
    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  // Use well-known dev key for localnet
  if (config.network === 'localnet' || !config.network) {
    return privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`);
  }

  throw new Error('DEPLOYER_PRIVATE_KEY required');
}

async function buildFrontend(appDir: string): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  await proc.exited;
  
  if (proc.exitCode !== 0) {
    throw new Error('Frontend build failed');
  }
}

async function deployFrontendToIPFS(buildDir: string, owner: Address): Promise<string> {
  const storage = getStorageServiceFromEnv();
  
  // Collect all files
  const files: Array<{ path: string; content: Uint8Array }> = [];
  
  const collectFiles = (dir: string, basePath = '') => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relativePath = basePath ? `${basePath}/${entry}` : entry;
      
      if (statSync(fullPath).isDirectory()) {
        collectFiles(fullPath, relativePath);
      } else {
        files.push({
          path: relativePath,
          content: new Uint8Array(readFileSync(fullPath)),
        });
      }
    }
  };
  
  collectFiles(buildDir);
  
  // TODO: In production, upload manifest alongside files
  // For now, just upload index.html directly
  void files.length; // Track file count for future manifest upload
  
  // Upload main index.html first
  const indexFile = files.find(f => f.path === 'index.html');
  if (!indexFile) {
    throw new Error('No index.html found in build directory');
  }
  
  const result = await storage.upload(indexFile.content, 'index.html', {
    tier: 'permanent',
    owner,
  });
  
  return result.cid;
}

function getPortFromManifest(appDir: string): number {
  const manifestPath = join(appDir, 'jeju-manifest.json');
  if (existsSync(manifestPath)) {
    const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const result = JejuManifestSchema.safeParse(rawManifest);
    if (!result.success) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${result.error.message}`);
    }
    const port = result.data.ports?.main;
    if (port === undefined) {
      throw new Error(`Manifest at ${manifestPath} missing ports.main`);
    }
    return port;
  }
  throw new Error(`No manifest found at ${manifestPath}`);
}

// Migration helper
export interface MigrationConfig {
  appName: string;
  tables: Array<{
    name: string;
    schema: string;
  }>;
  indexes?: Array<{
    table: string;
    columns: string[];
    unique?: boolean;
  }>;
}

export function generateMigrationSQL(config: MigrationConfig): string {
  const statements: string[] = [];
  
  // Create tables
  for (const table of config.tables) {
    statements.push(`-- Table: ${table.name}`);
    statements.push(table.schema);
    statements.push('');
  }
  
  // Create indexes
  if (config.indexes) {
    for (const idx of config.indexes) {
      const indexName = `idx_${idx.table}_${idx.columns.join('_')}`;
      const uniquePrefix = idx.unique ? 'UNIQUE ' : '';
      statements.push(`CREATE ${uniquePrefix}INDEX IF NOT EXISTS ${indexName} ON ${idx.table}(${idx.columns.join(', ')});`);
    }
  }
  
  return statements.join('\n');
}
