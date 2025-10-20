#!/usr/bin/env bun
/**
 * @title Snapshot Creator
 * @notice Creates snapshots of Jeju node data and uploads to S3/CDN
 * @dev Run this daily via cron on a healthy archive node
 * 
 * Features:
 * - Graceful node shutdown
 * - Data compression (tar.gz)
 * - Upload to S3
 * - Metadata generation
 * - Automatic cleanup
 * - Discord/Telegram notifications
 * 
 * Usage:
 *   bun run scripts/snapshots/create-snapshot.ts --network mainnet --type full
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, statSync, unlinkSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import * as tar from "tar";

const execAsync = promisify(exec);

// ============ Configuration ============

interface SnapshotConfig {
  network: 'mainnet' | 'testnet' | 'localnet';
  nodeType: 'full' | 'archive';
  dataDir: string;
  outputDir: string;
  s3Bucket: string;
  s3Region: string;
  discordWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  dockerComposePath?: string;
}

const CONFIG: SnapshotConfig = {
  network: (process.env.JEJU_NETWORK as any) || 'mainnet',
  nodeType: (process.env.NODE_TYPE as any) || 'full',
  dataDir: process.env.DATA_DIR || '/data',
  outputDir: process.env.OUTPUT_DIR || '/tmp/snapshots',
  s3Bucket: process.env.S3_BUCKET || 'jeju-snapshots',
  s3Region: process.env.S3_REGION || 'us-east-1',
  discordWebhook: process.env.DISCORD_WEBHOOK,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  dockerComposePath: process.env.DOCKER_COMPOSE_PATH || '~/.jeju',
};

// ============ S3 Client ============

const s3Client = new S3Client({
  region: CONFIG.s3Region,
});

// ============ Utilities ============

async function sendNotification(message: string, isError: boolean = false) {
  const emoji = isError ? '❌' : '✅';
  const fullMessage = `${emoji} **Jeju Snapshot** (${CONFIG.network})\n${message}`;
  
  console.log(fullMessage);
  
  // Discord
  if (CONFIG.discordWebhook) {
    try {
      await fetch(CONFIG.discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fullMessage }),
      });
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
    }
  }
  
  // Telegram
  if (CONFIG.telegramBotToken && CONFIG.telegramChatId) {
    try {
      await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.telegramChatId,
          text: fullMessage,
          parse_mode: 'Markdown',
        }),
      });
    } catch (error) {
      console.error('Failed to send Telegram notification:', error);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ============ Node Management ============

async function stopNode(): Promise<void> {
  console.log('🛑 Stopping node gracefully...');
  
  try {
    const { stdout } = await execAsync('docker-compose ps -q', {
      cwd: CONFIG.dockerComposePath,
    });
    
    if (stdout.trim()) {
      await execAsync('docker-compose stop', {
        cwd: CONFIG.dockerComposePath,
      });
      console.log('✅ Node stopped successfully');
    } else {
      console.log('ℹ️  Node was not running');
    }
  } catch (error) {
    console.error('⚠️  Failed to stop node:', error);
    throw error;
  }
}

async function startNode(): Promise<void> {
  console.log('▶️  Starting node...');
  
  try {
    await execAsync('docker-compose up -d', {
      cwd: CONFIG.dockerComposePath,
    });
    console.log('✅ Node started successfully');
  } catch (error) {
    console.error('❌ Failed to start node:', error);
    throw error;
  }
}

// ============ Snapshot Creation ============

async function getLatestBlockNumber(): Promise<number> {
  try {
    const response = await fetch('http://localhost:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    
    const data = await response.json() as { result: string };
    return parseInt(data.result, 16);
  } catch (error) {
    console.warn('⚠️  Could not fetch block number:', error);
    return 0;
  }
}

async function createTarball(sourceDir: string, outputFile: string): Promise<void> {
  console.log('📦 Creating tarball...');
  console.log(`   Source: ${sourceDir}`);
  console.log(`   Output: ${outputFile}`);
  
  const startTime = Date.now();
  
  try {
    // Create tar.gz archive
    await tar.create(
      {
        gzip: true,
        file: outputFile,
        cwd: sourceDir,
        // Exclude logs and temp files
        filter: (path) => {
          return !path.includes('logs/') && 
                 !path.includes('tmp/') && 
                 !path.endsWith('.lock');
        },
      },
      ['.']
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const size = statSync(outputFile).size;
    
    console.log(`✅ Tarball created in ${duration}s (${formatBytes(size)})`);
  } catch (error) {
    console.error('❌ Failed to create tarball:', error);
    throw error;
  }
}

// ============ S3 Upload ============

async function uploadToS3(filePath: string, s3Key: string): Promise<void> {
  console.log('☁️  Uploading to S3...');
  console.log(`   Bucket: ${CONFIG.s3Bucket}`);
  console.log(`   Key: ${s3Key}`);
  
  const startTime = Date.now();
  const fileSize = statSync(filePath).size;
  
  try {
    const fileStream = createReadStream(filePath);
    
    await s3Client.send(new PutObjectCommand({
      Bucket: CONFIG.s3Bucket,
      Key: s3Key,
      Body: fileStream,
      ContentType: 'application/gzip',
      Metadata: {
        'network': CONFIG.network,
        'node-type': CONFIG.nodeType,
        'created-at': new Date().toISOString(),
      },
    }));
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const speed = (fileSize / (1024 * 1024) / (Date.now() - startTime) * 1000).toFixed(2);
    
    console.log(`✅ Upload complete in ${duration}s (${speed} MB/s)`);
  } catch (error) {
    console.error('❌ S3 upload failed:', error);
    throw error;
  }
}

async function uploadMetadata(metadata: any, s3Key: string): Promise<void> {
  console.log('📋 Uploading metadata...');
  
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: CONFIG.s3Bucket,
      Key: s3Key,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));
    
    console.log('✅ Metadata uploaded');
  } catch (error) {
    console.error('❌ Metadata upload failed:', error);
    throw error;
  }
}

// ============ Main Process ============

async function createSnapshot() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Jeju Snapshot Creator');
  console.log('='.repeat(60));
  console.log(`Network: ${CONFIG.network}`);
  console.log(`Node Type: ${CONFIG.nodeType}`);
  console.log(`Data Dir: ${CONFIG.dataDir}`);
  console.log('='.repeat(60) + '\n');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapshotName = `${CONFIG.network}-${CONFIG.nodeType}-${timestamp}`;
  const outputFile = `${CONFIG.outputDir}/${snapshotName}.tar.gz`;
  const s3Key = `${CONFIG.network}/${snapshotName}.tar.gz`;
  const s3KeyLatest = `${CONFIG.network}-${CONFIG.nodeType}-latest.tar.gz`;
  const metadataKey = `${CONFIG.network}/${snapshotName}.json`;
  const metadataKeyLatest = `${CONFIG.network}-${CONFIG.nodeType}-latest.json`;
  
  let blockNumber = 0;
  
  try {
    // Get current block before stopping
    blockNumber = await getLatestBlockNumber();
    console.log(`📊 Current block: ${blockNumber}`);
    
    // Send start notification
    await sendNotification(
      `Starting snapshot creation at block ${blockNumber}`,
      false
    );
    
    // Stop node
    await stopNode();
    
    // Wait a bit to ensure clean shutdown
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Create tarball
    await createTarball(CONFIG.dataDir, outputFile);
    
    // Start node back up (don't wait)
    startNode().catch(console.error);
    
    // Prepare metadata
    const fileSize = statSync(outputFile).size;
    const metadata = {
      network: CONFIG.network,
      nodeType: CONFIG.nodeType,
      blockNumber,
      timestamp: new Date().toISOString(),
      size: fileSize,
      sizeFormatted: formatBytes(fileSize),
      filename: snapshotName + '.tar.gz',
      downloadUrl: `https://${CONFIG.s3Bucket}.s3.${CONFIG.s3Region}.amazonaws.com/${s3Key}`,
    };
    
    // Upload to S3 (versioned)
    await uploadToS3(outputFile, s3Key);
    await uploadMetadata(metadata, metadataKey);
    
    // Upload as "latest" (overwrite)
    await uploadToS3(outputFile, s3KeyLatest);
    await uploadMetadata(metadata, metadataKeyLatest);
    
    // Cleanup local file
    console.log('🧹 Cleaning up...');
    unlinkSync(outputFile);
    
    // Send success notification
    await sendNotification(
      `Snapshot created successfully!\n` +
      `Block: ${blockNumber}\n` +
      `Size: ${formatBytes(fileSize)}\n` +
      `URL: ${metadata.downloadUrl}`,
      false
    );
    
    console.log('\n✅ Snapshot creation complete!');
    console.log(`Download: ${metadata.downloadUrl}`);
    
  } catch (error) {
    console.error('\n❌ Snapshot creation failed:', error);
    
    // Try to restart node if it failed
    try {
      await startNode();
    } catch (restartError) {
      console.error('❌ Failed to restart node:', restartError);
    }
    
    // Send error notification
    await sendNotification(
      `Snapshot creation failed: ${error}`,
      true
    );
    
    throw error;
  }
}

// ============ CLI ============

if (import.meta.main) {
  createSnapshot()
    .then(() => {
      console.log('\n🎉 Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

export { createSnapshot };

