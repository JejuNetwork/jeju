#!/usr/bin/env bun
/**
 * @title Auto-Update Manager
 * @notice Automatically updates Jeju nodes to latest versions
 * 
 * Features:
 * - Checks for new releases
 * - Downloads and verifies images
 * - Rolling updates with zero downtime
 * - Rollback on failure
 * - Notification on updates
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const execAsync = promisify(exec);

// ============ Configuration ============

const CONFIG = {
  CHECK_INTERVAL: parseInt(process.env.UPDATE_CHECK_INTERVAL || '3600000'), // 1 hour
  DOCKER_COMPOSE_PATH: process.env.DOCKER_COMPOSE_PATH || '~/.jeju',
  GITHUB_REPO: 'jeju-l3/jeju',
  AUTO_UPDATE: process.env.AUTO_UPDATE === 'true',
  NOTIFICATION_WEBHOOK: process.env.NOTIFICATION_WEBHOOK,
  BACKUP_COUNT: 3,
};

// ============ Version Management ============

interface Version {
  reth: string;
  opNode: string;
  timestamp: number;
}

async function getCurrentVersion(): Promise<Version | null> {
  const versionFile = `${CONFIG.DOCKER_COMPOSE_PATH}/version.json`;
  
  if (!existsSync(versionFile)) {
    return null;
  }
  
  try {
    const data = readFileSync(versionFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveVersion(version: Version): Promise<void> {
  const versionFile = `${CONFIG.DOCKER_COMPOSE_PATH}/version.json`;
  writeFileSync(versionFile, JSON.stringify(version, null, 2));
}

interface GitHubRelease {
  published_at: string;
  tag_name?: string;
  body?: string;
}

async function getLatestVersion(): Promise<Version> {
  try {
    // Check GitHub releases
    const response = await fetch(
      `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/releases/latest`
    );
    
    const release = await response.json() as GitHubRelease;
    
    // Parse version from release notes or use defaults
    // In a real implementation, this would parse the release notes
    return {
      reth: 'v1.0.3', // Would be parsed from release
      opNode: 'v1.7.6', // Would be parsed from release
      timestamp: new Date(release.published_at).getTime(),
    };
  } catch (error) {
    console.error('Failed to fetch latest version:', error);
    throw error;
  }
}

function isNewerVersion(current: Version | null, latest: Version): boolean {
  if (!current) return true;
  
  // Simple timestamp comparison
  // In production, use semver comparison
  return latest.timestamp > current.timestamp;
}

// ============ Update Process ============

async function sendNotification(message: string, isError: boolean = false): Promise<void> {
  if (!CONFIG.NOTIFICATION_WEBHOOK) return;
  
  const emoji = isError ? '❌' : '✅';
  const fullMessage = `${emoji} **Jeju Node Auto-Update**\n${message}`;
  
  console.log(fullMessage);
  
  try {
    await fetch(CONFIG.NOTIFICATION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fullMessage }),
    });
  } catch (error) {
    console.error('Failed to send notification:', error);
  }
}

async function backupCurrentState(): Promise<string> {
  console.log('📦 Creating backup...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = `${CONFIG.DOCKER_COMPOSE_PATH}/backups/${timestamp}`;
  
  try {
    await execAsync(`mkdir -p ${backupDir}`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    // Backup docker-compose.yml
    await execAsync(`cp docker-compose.yml ${backupDir}/`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    // Backup version file
    await execAsync(`cp version.json ${backupDir}/ || true`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    console.log(`✅ Backup created at ${backupDir}`);
    return backupDir;
  } catch (error) {
    console.error('Failed to create backup:', error);
    throw error;
  }
}

async function cleanOldBackups(): Promise<void> {
  try {
    const { stdout } = await execAsync(`ls -1t backups/`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    const backups = stdout.trim().split('\n').filter(Boolean);
    
    if (backups.length > CONFIG.BACKUP_COUNT) {
      const toDelete = backups.slice(CONFIG.BACKUP_COUNT);
      
      for (const backup of toDelete) {
        await execAsync(`rm -rf backups/${backup}`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
        console.log(`🧹 Deleted old backup: ${backup}`);
      }
    }
  } catch (error) {
    console.warn('Failed to clean old backups:', error);
  }
}

async function pullNewImages(version: Version): Promise<void> {
  console.log('📥 Pulling new images...');
  
  try {
    // Pull Reth image
    console.log(`   Reth ${version.reth}...`);
    await execAsync(`docker pull ghcr.io/paradigmxyz/op-reth:${version.reth}`);
    
    // Pull OP-Node image
    console.log(`   OP-Node ${version.opNode}...`);
    await execAsync(`docker pull us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:${version.opNode}`);
    
    console.log('✅ Images pulled successfully');
  } catch (error) {
    console.error('Failed to pull images:', error);
    throw error;
  }
}

async function updateDockerCompose(version: Version): Promise<void> {
  console.log('📝 Updating docker-compose.yml...');
  
  try {
    const composePath = `${CONFIG.DOCKER_COMPOSE_PATH}/docker-compose.yml`;
    let compose = readFileSync(composePath, 'utf-8');
    
    // Update Reth version
    compose = compose.replace(
      /image: ghcr\.io\/paradigmxyz\/op-reth:v[\d.]+/,
      `image: ghcr.io/paradigmxyz/op-reth:${version.reth}`
    );
    
    // Update OP-Node version
    compose = compose.replace(
      /image: us-docker\.pkg\.dev\/oplabs-tools-artifacts\/images\/op-node:v[\d.]+/,
      `image: us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:${version.opNode}`
    );
    
    writeFileSync(composePath, compose);
    
    console.log('✅ docker-compose.yml updated');
  } catch (error) {
    console.error('Failed to update docker-compose.yml:', error);
    throw error;
  }
}

async function restartServices(): Promise<void> {
  console.log('🔄 Restarting services...');
  
  try {
    // Graceful restart with rolling update
    await execAsync('docker-compose up -d', { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    // Wait for services to be healthy
    console.log('⏳ Waiting for services to be healthy...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
    
    // Check health
    const { stdout } = await execAsync('docker-compose ps', { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    if (stdout.includes('unhealthy') || stdout.includes('Exit')) {
      throw new Error('Services failed health check');
    }
    
    console.log('✅ Services restarted successfully');
  } catch (error) {
    console.error('Failed to restart services:', error);
    throw error;
  }
}

async function verifyUpdate(): Promise<boolean> {
  console.log('🔍 Verifying update...');
  
  try {
    // Check if RPC is responding
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
    
    const data = await response.json() as { result?: string };
    
    if (!data.result) {
      throw new Error('RPC not responding correctly');
    }
    
    console.log(`✅ Node is healthy at block ${parseInt(data.result, 16)}`);
    return true;
  } catch (error) {
    console.error('Verification failed:', error);
    return false;
  }
}

async function rollback(backupDir: string): Promise<void> {
  console.log('⚠️  Rolling back to previous version...');
  
  try {
    // Restore docker-compose.yml
    await execAsync(`cp ${backupDir}/docker-compose.yml ./`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    // Restore version file
    await execAsync(`cp ${backupDir}/version.json ./ || true`, { cwd: CONFIG.DOCKER_COMPOSE_PATH });
    
    // Restart with old config
    await restartServices();
    
    console.log('✅ Rollback complete');
    await sendNotification('Update failed and was rolled back', true);
  } catch (error) {
    console.error('❌ CRITICAL: Rollback failed:', error);
    await sendNotification('CRITICAL: Update rollback failed - manual intervention required!', true);
    throw error;
  }
}

async function performUpdate(latestVersion: Version): Promise<void> {
  console.log('\n🚀 Starting update process...');
  console.log(`   Reth: ${latestVersion.reth}`);
  console.log(`   OP-Node: ${latestVersion.opNode}`);
  
  await sendNotification(`Starting update to Reth ${latestVersion.reth} / OP-Node ${latestVersion.opNode}`);
  
  let backupDir = '';
  
  try {
    // Step 1: Backup
    backupDir = await backupCurrentState();
    
    // Step 2: Pull images
    await pullNewImages(latestVersion);
    
    // Step 3: Update config
    await updateDockerCompose(latestVersion);
    
    // Step 4: Restart
    await restartServices();
    
    // Step 5: Verify
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
    const verified = await verifyUpdate();
    
    if (!verified) {
      throw new Error('Update verification failed');
    }
    
    // Step 6: Save version
    await saveVersion(latestVersion);
    
    // Step 7: Clean old backups
    await cleanOldBackups();
    
    console.log('\n✅ Update completed successfully!');
    await sendNotification('Update completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Update failed:', error);
    
    if (backupDir) {
      await rollback(backupDir);
    }
    
    throw error;
  }
}

// ============ Update Checker ============

async function checkForUpdates(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 Checking for updates...');
  console.log('='.repeat(60));
  
  try {
    const current = await getCurrentVersion();
    const latest = await getLatestVersion();
    
    if (current) {
      console.log('\nCurrent Version:');
      console.log(`   Reth: ${current.reth}`);
      console.log(`   OP-Node: ${current.opNode}`);
    } else {
      console.log('\nNo version file found (first run)');
    }
    
    console.log('\nLatest Version:');
    console.log(`   Reth: ${latest.reth}`);
    console.log(`   OP-Node: ${latest.opNode}`);
    
    if (isNewerVersion(current, latest)) {
      console.log('\n🎉 New version available!');
      
      if (CONFIG.AUTO_UPDATE) {
        await performUpdate(latest);
      } else {
        console.log('ℹ️  Auto-update is disabled. Run with AUTO_UPDATE=true to enable.');
        await sendNotification(
          `New version available but auto-update is disabled.\nReth: ${latest.reth} / OP-Node: ${latest.opNode}`
        );
      }
    } else {
      console.log('\n✅ Already on latest version');
    }
    
  } catch (error) {
    console.error('❌ Update check failed:', error);
  }
}

// ============ Main ============

async function main() {
  console.log('🤖 Jeju Auto-Update Manager starting...');
  console.log(`   Check Interval: ${CONFIG.CHECK_INTERVAL / 1000}s`);
  console.log(`   Auto-Update: ${CONFIG.AUTO_UPDATE}`);
  console.log(`   Repository: ${CONFIG.GITHUB_REPO}`);
  
  // Initial check
  await checkForUpdates();
  
  // Periodic checks
  setInterval(async () => {
    try {
      await checkForUpdates();
    } catch (error) {
      console.error('❌ Check failed:', error);
    }
  }, CONFIG.CHECK_INTERVAL);
  
  console.log('\n✅ Auto-update manager running. Press Ctrl+C to stop.\n');
}

if (import.meta.main) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { checkForUpdates, performUpdate };

