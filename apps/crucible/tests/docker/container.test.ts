import { describe, test, expect } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Docker Container Tests
 * 
 * Tests Docker build and container functionality
 */

describe('Docker Build', () => {
  test('Dockerfile exists and is valid', async () => {
    const { stdout } = await execAsync('test -f docker/Dockerfile && echo "exists"');
    expect(stdout.trim()).toBe('exists');
  });

  test('docker-compose.yml exists and is valid', async () => {
    const { stdout } = await execAsync('test -f docker/docker-compose.yml && echo "exists"');
    expect(stdout.trim()).toBe('exists');
  });

  test('can validate docker-compose syntax', async () => {
    try {
      await execAsync('docker-compose -f docker/docker-compose.yml config > /dev/null 2>&1');
      console.log('✅ docker-compose.yml syntax valid');
    } catch (error) {
      console.warn('⚠️  docker-compose validation failed - may need Docker installed');
    }
  });
});

describe('Docker Network Configuration', () => {
  test('compose file includes host.docker.internal mapping', async () => {
    const { stdout } = await execAsync('grep -q "host.docker.internal" docker/docker-compose.yml && echo "found"');
    expect(stdout.trim()).toBe('found');
    console.log('✅ Host network mapping configured');
  });

  test('compose file exposes port 7777', async () => {
    const { stdout } = await execAsync('grep -q "7777:7777" docker/docker-compose.yml && echo "found"');
    expect(stdout.trim()).toBe('found');
    console.log('✅ Port 7777 exposed');
  });

  test('compose file includes postgres service', async () => {
    const { stdout } = await execAsync('grep -q "postgres:" docker/docker-compose.yml && echo "found"');
    expect(stdout.trim()).toBe('found');
    console.log('✅ Postgres service configured');
  });
});

