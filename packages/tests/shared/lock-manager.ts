/**
 * Lock Manager - Prevents concurrent E2E test runs
 * 
 * ASSUMPTIONS:
 * - Lock file at workspace root (.jeju/.jeju-e2e-test.lock)
 * - 30-minute TTL is sufficient for test runs
 * - PID 0 signal can detect dead processes (Unix-like systems)
 * 
 * LIMITATIONS:
 * - SIGKILL (kill -9) won't trigger cleanup - lock becomes stale
 * - Cross-machine locking requires shared filesystem
 * - Clock skew affects TTL accuracy in distributed setups
 * 
 * ATOMIC GUARANTEES:
 * - Uses 'wx' flag for exclusive file creation
 * - Uses rename for atomic stale lock replacement
 * - Verifies ownership after replacement to handle races
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync, renameSync, mkdirSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

export interface LockMetadata {
  pid: number;
  timestamp: number;
  hostname: string;
  command: string;
}

export interface LockManagerOptions {
  lockDir?: string;
  ttlMs?: number;
  force?: boolean;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes - adjust if tests take longer
const LOCK_FILE = '.jeju/.jeju-e2e-test.lock';
const MAX_ACQUIRE_ATTEMPTS = 3;

function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name === 'jeju') return dir;
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

export class LockManager {
  private readonly lockPath: string;
  private readonly ttlMs: number;
  private readonly force: boolean;
  private isLockOwner = false;
  private cleanupRegistered = false;

  constructor(options: LockManagerOptions = {}) {
    const lockDir = options.lockDir ?? findWorkspaceRoot();
    this.lockPath = join(lockDir, LOCK_FILE);
    // Ensure .jeju directory exists
    const jejuDir = join(lockDir, '.jeju');
    if (!existsSync(jejuDir)) {
      mkdirSync(jejuDir, { recursive: true });
    }
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.force = options.force ?? false;
  }

  isLocked(): { locked: boolean; metadata?: LockMetadata; stale?: boolean } {
    if (!existsSync(this.lockPath)) {
      return { locked: false };
    }

    const metadata: LockMetadata = JSON.parse(readFileSync(this.lockPath, 'utf-8'));
    const age = Date.now() - metadata.timestamp;
    const stale = age > this.ttlMs || !this.isProcessRunning(metadata.pid);

    return { locked: true, metadata, stale };
  }

  acquireLock(): { acquired: boolean; blockedBy?: LockMetadata; message?: string } {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      // Try atomic create first
      const metadata: LockMetadata = {
        pid: process.pid,
        timestamp: Date.now(),
        hostname: hostname(),
        command: process.argv.join(' '),
      };

      if (this.tryAtomicCreate(metadata)) {
        this.isLockOwner = true;
        this.registerCleanupHandlers();
        console.log(`[LockManager] Lock acquired (PID: ${process.pid})`);
        return { acquired: true };
      }

      // Lock exists - check if stale or active
      const status = this.isLocked();
      if (!status.locked) {
        // Race: lock disappeared, retry
        continue;
      }

      if (!status.stale && !this.force) {
        const meta = status.metadata;
        const ageMinutes = meta ? Math.floor((Date.now() - meta.timestamp) / 60000) : 0;
        return {
          acquired: false,
          blockedBy: meta,
          message: `E2E tests already running (PID: ${meta?.pid}, ${ageMinutes}m ago). Use --force to override.`,
        };
      }

      // Stale or force - try to claim it atomically
      console.log(`[LockManager] Cleaning stale lock from PID ${status.metadata?.pid}`);
      if (this.tryAtomicReplace(metadata)) {
        this.isLockOwner = true;
        this.registerCleanupHandlers();
        console.log(`[LockManager] Lock acquired after cleanup (PID: ${process.pid})`);
        return { acquired: true };
      }

      // Another process beat us - small delay and retry
      if (attempt < MAX_ACQUIRE_ATTEMPTS - 1) {
        const delay = 50 + Math.random() * 100;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return { acquired: false, message: 'Failed to acquire lock after retries' };
  }

  private tryAtomicCreate(metadata: LockMetadata): boolean {
    try {
      // Ensure directory exists (lockPath might be just filename or full path)
      const lockDir = join(this.lockPath, '..');
      if (lockDir !== this.lockPath && !existsSync(lockDir)) {
        mkdirSync(lockDir, { recursive: true });
      }
      writeFileSync(this.lockPath, JSON.stringify(metadata, null, 2), { flag: 'wx' });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  private tryAtomicReplace(metadata: LockMetadata): boolean {
    const tempPath = `${this.lockPath}.${randomBytes(8).toString('hex')}`;
    try {
      // Ensure directory exists
      const lockDir = join(this.lockPath, '..');
      if (lockDir !== this.lockPath && !existsSync(lockDir)) {
        mkdirSync(lockDir, { recursive: true });
      }
      writeFileSync(tempPath, JSON.stringify(metadata, null, 2));
      // Atomic rename - if lock was modified by another process, this still works
      // but we verify ownership after
      renameSync(tempPath, this.lockPath);
      
      // Verify we own it (another process could have done same thing)
      const current = JSON.parse(readFileSync(this.lockPath, 'utf-8')) as LockMetadata;
      return current.pid === process.pid && current.timestamp === metadata.timestamp;
    } catch {
      try { unlinkSync(tempPath); } catch { /* ignore */ }
      return false;
    }
  }

  releaseLock(): boolean {
    if (!this.isLockOwner || !existsSync(this.lockPath)) {
      return false;
    }

    const metadata: LockMetadata = JSON.parse(readFileSync(this.lockPath, 'utf-8'));
    if (metadata.pid !== process.pid) {
      return false;
    }

    unlinkSync(this.lockPath);
    console.log(`[LockManager] Lock released (PID: ${process.pid})`);
    this.isLockOwner = false;
    return true;
  }

  forceReleaseLock(): void {
    if (existsSync(this.lockPath)) {
      unlinkSync(this.lockPath);
    }
  }

  getLockPath(): string {
    return this.lockPath;
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private registerCleanupHandlers(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => this.releaseLock();

    process.on('SIGINT', () => { cleanup(); process.exit(130); });
    process.on('SIGTERM', () => { cleanup(); process.exit(143); });
    process.on('exit', cleanup);
    process.on('uncaughtException', (err) => {
      console.error('[LockManager] Uncaught exception:', err.message);
      cleanup();
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      console.error('[LockManager] Unhandled rejection:', reason);
      cleanup();
      process.exit(1);
    });
  }
}

export async function withTestLock<T>(fn: () => Promise<T>, options?: LockManagerOptions): Promise<T> {
  const lock = new LockManager(options);
  const result = lock.acquireLock();

  if (!result.acquired) {
    throw new Error(result.message || 'Lock not acquired');
  }

  try {
    return await fn();
  } finally {
    lock.releaseLock();
  }
}
