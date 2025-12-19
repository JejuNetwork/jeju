/**
 * Playwright Global Teardown for E2E Tests
 * 
 * Stops all services started during setup
 */

import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const STATE_FILE = join(dirname(__dirname), '.e2e-state.json');

interface E2EState {
  pids: number[];
  ports: {
    localnet: number;
    dws: number;
    frontend: number;
  };
}

export default async function globalTeardown() {
  console.log('\n=== DWS E2E Test Teardown ===\n');

  if (!existsSync(STATE_FILE)) {
    console.log('[E2E] No state file found, nothing to clean up');
    return;
  }

  try {
    const state: E2EState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

    for (const pid of state.pids) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[E2E] Stopped process ${pid}`);
      } catch {
        // Process may have already exited
      }
    }

    unlinkSync(STATE_FILE);
  } catch (e) {
    console.warn('[E2E] Error during teardown:', e);
  }

  console.log('[E2E] Teardown complete\n');
}

