import { describe, test, expect } from 'bun:test';
import {
  checkCommand,
  getSystemInfo,
  getNetworkDir,
  getKeysDir,
} from './system';

describe('System Utilities', () => {
  test('checkCommand finds existing commands', async () => {
    // These should exist on any Unix system
    const hasLs = await checkCommand('ls');
    expect(hasLs).toBe(true);
    
    const hasBun = await checkCommand('bun');
    expect(hasBun).toBe(true);
  });

  test('checkCommand returns false for non-existent commands', async () => {
    const hasNonExistent = await checkCommand('definitely-not-a-real-command-12345');
    expect(hasNonExistent).toBe(false);
  });

  test('getSystemInfo returns valid info', () => {
    const info = getSystemInfo();
    expect(info.os).toBeDefined();
    expect(info.arch).toBeDefined();
    expect(info.home).toBeDefined();
    expect(info.home.startsWith('/')).toBe(true);
  });

  test('getNetworkDir returns path in home directory', () => {
    const dir = getNetworkDir();
    expect(dir).toContain('.jeju');
    expect(dir.startsWith('/')).toBe(true);
  });

  test('getKeysDir returns path under jeju dir', () => {
    const dir = getKeysDir();
    expect(dir).toContain('.jeju');
    expect(dir).toContain('keys');
  });
});

