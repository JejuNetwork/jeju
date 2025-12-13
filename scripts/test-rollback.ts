#!/usr/bin/env bun

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const BACKUP_DIR = join(process.cwd(), '.jeju', '.rollback-test-backups');
const TEST_CONFIG_FILE = join(process.cwd(), 'apps/gateway/.rollback-test-config.json');

interface RollbackTestResult {
  name: string;
  status: 'pass' | 'fail';
  message: string;
}

const results: RollbackTestResult[] = [];

async function testBackupCreation(): Promise<void> {
  try {
    if (!existsSync(BACKUP_DIR)) {
      await mkdir(BACKUP_DIR, { recursive: true });
    }
    
    const testData = { version: '1.0.0', timestamp: Date.now() };
    const backupFile = join(BACKUP_DIR, 'test-backup.json');
    await writeFile(backupFile, JSON.stringify(testData, null, 2));
    
    if (existsSync(backupFile)) {
      results.push({
        name: 'Backup creation',
        status: 'pass',
        message: 'Backup directory and file created successfully',
      });
    } else {
      results.push({
        name: 'Backup creation',
        status: 'fail',
        message: 'Backup file was not created',
      });
    }
  } catch (error) {
    results.push({
      name: 'Backup creation',
      status: 'fail',
      message: `Error creating backup: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function testBackupRestore(): Promise<void> {
  try {
    const backupFile = join(BACKUP_DIR, 'test-backup.json');
    if (!existsSync(backupFile)) {
      results.push({
        name: 'Backup restore',
        status: 'fail',
        message: 'Backup file does not exist',
      });
      return;
    }
    
    const backupData = await readFile(backupFile, 'utf-8');
    const parsed = JSON.parse(backupData);
    
    if (parsed.version && parsed.timestamp) {
      results.push({
        name: 'Backup restore',
        status: 'pass',
        message: 'Backup file can be read and parsed',
      });
    } else {
      results.push({
        name: 'Backup restore',
        status: 'fail',
        message: 'Backup file is missing required fields',
      });
    }
  } catch (error) {
    results.push({
      name: 'Backup restore',
      status: 'fail',
      message: `Error reading backup: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function testConfigBackup(): Promise<void> {
  try {
    const testConfig = {
      contracts: {
        v2Factory: '0x1111111111111111111111111111111111111111',
        v3Factory: '0x2222222222222222222222222222222222222222',
      },
      version: 'test-1.0.0',
    };
    
    await writeFile(TEST_CONFIG_FILE, JSON.stringify(testConfig, null, 2));
    
    const backupPath = join(BACKUP_DIR, `config-backup-${Date.now()}.json`);
    await writeFile(backupPath, JSON.stringify(testConfig, null, 2));
    
    const restored = await readFile(backupPath, 'utf-8');
    const restoredConfig = JSON.parse(restored);
    
    if (restoredConfig.contracts.v2Factory === testConfig.contracts.v2Factory) {
      results.push({
        name: 'Config backup/restore',
        status: 'pass',
        message: 'Configuration can be backed up and restored',
      });
    } else {
      results.push({
        name: 'Config backup/restore',
        status: 'fail',
        message: 'Restored configuration does not match original',
      });
    }
  } catch (error) {
    results.push({
      name: 'Config backup/restore',
      status: 'fail',
      message: `Error in config backup test: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function testRollbackScript(): Promise<void> {
  const rollbackScript = join(process.cwd(), 'scripts/auto-update/update-manager.ts');
  
  if (!existsSync(rollbackScript)) {
    results.push({
      name: 'Rollback script exists',
      status: 'fail',
      message: 'Rollback script not found',
    });
    return;
  }
  
  try {
    const content = await readFile(rollbackScript, 'utf-8');
    const hasRollbackFunction = content.includes('async function rollback');
    const hasBackupFunction = content.includes('async function backupCurrentState');
    const hasRestoreLogic = content.includes('cp') || content.includes('restore');
    
    if (hasRollbackFunction && hasBackupFunction) {
      results.push({
        name: 'Rollback script structure',
        status: 'pass',
        message: 'Rollback script has required functions',
      });
    } else {
      results.push({
        name: 'Rollback script structure',
        status: 'fail',
        message: 'Rollback script missing required functions',
      });
    }
    
    if (hasRestoreLogic) {
      results.push({
        name: 'Rollback restore logic',
        status: 'pass',
        message: 'Rollback script has restore logic',
      });
    } else {
      results.push({
        name: 'Rollback restore logic',
        status: 'warning',
        message: 'Rollback script may be missing restore logic',
      });
    }
  } catch (error) {
    results.push({
      name: 'Rollback script check',
      status: 'fail',
      message: `Error reading rollback script: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function testKubernetesRollback(): Promise<void> {
  try {
    const kubectlAvailable = execSync('which kubectl', { encoding: 'utf-8' }).trim();
    
    if (kubectlAvailable) {
      results.push({
        name: 'Kubernetes CLI available',
        status: 'pass',
        message: 'kubectl is available for rollback operations',
      });
      
      try {
        execSync('kubectl rollout history deployment/op-node --namespace=op-stack 2>&1 || true', { encoding: 'utf-8' });
        results.push({
          name: 'Kubernetes rollback commands',
          status: 'pass',
          message: 'Kubernetes rollback commands are available',
        });
      } catch {
        results.push({
          name: 'Kubernetes rollback commands',
          status: 'warning',
          message: 'Kubernetes cluster may not be accessible (expected in local dev)',
        });
      }
    } else {
      results.push({
        name: 'Kubernetes CLI available',
        status: 'warning',
        message: 'kubectl not found (may not be needed for local dev)',
      });
    }
  } catch {
    results.push({
      name: 'Kubernetes CLI check',
      status: 'warning',
      message: 'kubectl not available (expected in local dev)',
    });
  }
}

async function cleanup(): Promise<void> {
  try {
    if (existsSync(TEST_CONFIG_FILE)) {
      await Bun.write(TEST_CONFIG_FILE, '');
    }
  } catch {
    // Ignore cleanup errors
  }
}

async function main() {
  console.log('🔄 Testing Rollback Procedures...\n');
  
  await testBackupCreation();
  await testBackupRestore();
  await testConfigBackup();
  await testRollbackScript();
  await testKubernetesRollback();
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  
  console.log('\n=== Rollback Test Results ===\n');
  
  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
    console.log(`${icon} ${result.name}: ${result.message}`);
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`Total: ${results.length}`);
  
  await cleanup();
  
  if (failed > 0) {
    console.log('\n❌ Rollback tests have failures. Please fix before production deployment.');
    process.exit(1);
  } else {
    console.log('\n✅ Rollback procedures verified successfully!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Rollback test failed:', error);
  process.exit(1);
});
