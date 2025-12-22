/**
 * Infrastructure Service
 * 
 * Manages all required infrastructure for Jeju development:
 * - Docker (auto-start on macOS/Linux)
 * - Docker Compose services (CQL, IPFS, Cache, DA)
 * - Localnet (Anvil)
 * 
 * NO FALLBACKS - all infrastructure must be running.
 */

import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { logger } from '../lib/logger';
import { DEFAULT_PORTS } from '../types';

export interface ServiceHealth {
  name: string;
  port: number;
  healthy: boolean;
  url: string;
}

export interface InfrastructureStatus {
  docker: boolean;
  services: ServiceHealth[];
  localnet: boolean;
  allHealthy: boolean;
}

// Required Docker services for DWS
const REQUIRED_SERVICES = {
  cql: { port: 4661, healthPath: '/health', name: 'CovenantSQL', container: 'jeju-cql' },
  ipfs: { port: 5001, healthPath: '/api/v0/id', name: 'IPFS', container: 'jeju-ipfs' },
  cache: { port: 4115, healthPath: '/health', name: 'Cache Service', container: 'jeju-cache' },
  da: { port: 4010, healthPath: '/health', name: 'DA Server', container: 'jeju-da' },
} as const;

const LOCALNET_PORT = DEFAULT_PORTS.l2Rpc;

export class InfrastructureService {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Check if Docker is running
   */
  async isDockerRunning(): Promise<boolean> {
    try {
      const result = await execa('docker', ['info'], { 
        timeout: 10000,
        reject: false,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker is installed
   */
  async isDockerInstalled(): Promise<boolean> {
    try {
      await execa('docker', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to start Docker
   * - macOS: Opens Docker Desktop
   * - Linux: Attempts to start docker service
   */
  async startDocker(): Promise<boolean> {
    const os = platform();
    
    logger.step('Starting Docker...');

    if (os === 'darwin') {
      // macOS - open Docker Desktop
      try {
        await execa('open', ['-a', 'Docker'], { reject: false });
        
        // Wait for Docker to be ready (up to 60 seconds)
        for (let i = 0; i < 60; i++) {
          await this.sleep(1000);
          if (await this.isDockerRunning()) {
            logger.success('Docker started');
            return true;
          }
          if (i % 10 === 9) {
            logger.info(`  Waiting for Docker to start... (${i + 1}s)`);
          }
        }
        
        logger.error('Docker failed to start within 60 seconds');
        return false;
      } catch {
        logger.error('Failed to start Docker Desktop');
        return false;
      }
    } else if (os === 'linux') {
      // Linux - try to start docker service
      try {
        await execa('sudo', ['systemctl', 'start', 'docker'], { 
          timeout: 30000,
          reject: false,
        });
        
        // Wait for Docker to be ready
        for (let i = 0; i < 30; i++) {
          await this.sleep(1000);
          if (await this.isDockerRunning()) {
            logger.success('Docker started');
            return true;
          }
        }
        
        return false;
      } catch {
        logger.error('Failed to start Docker service');
        logger.info('  Try: sudo systemctl start docker');
        return false;
      }
    } else {
      logger.error(`Unsupported OS: ${os}`);
      logger.info('  Please start Docker manually');
      return false;
    }
  }

  /**
   * Check health of a specific service
   */
  async checkServiceHealth(key: keyof typeof REQUIRED_SERVICES): Promise<ServiceHealth> {
    const config = REQUIRED_SERVICES[key];
    const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
    
    try {
      const response = await fetch(url, {
        method: config.healthPath.startsWith('/api/v0') ? 'POST' : 'GET',
        signal: AbortSignal.timeout(3000),
      });
      
      return {
        name: config.name,
        port: config.port,
        healthy: response.ok,
        url: `http://127.0.0.1:${config.port}`,
      };
    } catch {
      return {
        name: config.name,
        port: config.port,
        healthy: false,
        url: `http://127.0.0.1:${config.port}`,
      };
    }
  }

  /**
   * Check all Docker services
   */
  async checkServices(): Promise<ServiceHealth[]> {
    const results: ServiceHealth[] = [];
    
    for (const key of Object.keys(REQUIRED_SERVICES) as (keyof typeof REQUIRED_SERVICES)[]) {
      results.push(await this.checkServiceHealth(key));
    }
    
    return results;
  }

  /**
   * Start Docker Compose services
   */
  async startServices(): Promise<boolean> {
    logger.step('Starting Docker services...');
    
    const composePath = join(this.rootDir, 'docker-compose.yml');
    if (!existsSync(composePath)) {
      logger.error('docker-compose.yml not found');
      return false;
    }

    try {
      await execa('docker', [
        'compose', 'up', '-d',
        'cql', 'ipfs', 'cache-service', 'da-server',
      ], {
        cwd: this.rootDir,
        stdio: 'pipe',
      });

      // Wait for services to be healthy
      logger.info('  Waiting for services to be healthy...');
      for (let attempt = 0; attempt < 60; attempt++) {
        const services = await this.checkServices();
        const allHealthy = services.every(s => s.healthy);
        
        if (allHealthy) {
          for (const service of services) {
            logger.success(`  ${service.name} ready`);
          }
          return true;
        }
        
        await this.sleep(1000);
        
        if (attempt % 10 === 9) {
          const unhealthy = services.filter(s => !s.healthy).map(s => s.name);
          logger.info(`  Still waiting for: ${unhealthy.join(', ')}`);
        }
      }
      
      logger.error('Services did not become healthy within 60 seconds');
      return false;
    } catch (error) {
      logger.error('Failed to start Docker services');
      logger.debug(String(error));
      return false;
    }
  }

  /**
   * Stop Docker Compose services
   */
  async stopServices(): Promise<void> {
    logger.step('Stopping Docker services...');
    
    await execa('docker', ['compose', 'down'], {
      cwd: this.rootDir,
      stdio: 'pipe',
      reject: false, // Don't throw if services weren't running
    });
    logger.success('Docker services stopped');
  }

  /**
   * Check if localnet is running
   */
  async isLocalnetRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${LOCALNET_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start localnet (Anvil)
   */
  async startLocalnet(): Promise<boolean> {
    if (await this.isLocalnetRunning()) {
      logger.success('Localnet already running');
      return true;
    }

    logger.step('Starting localnet...');

    try {
      // Check if anvil is installed
      const { exitCode } = await execa('which', ['anvil'], { reject: false });
      if (exitCode !== 0) {
        logger.error('Anvil not found');
        logger.info('  Install: curl -L https://foundry.paradigm.xyz | bash');
        return false;
      }

      // Start anvil in background
      execa('anvil', ['--port', String(LOCALNET_PORT), '--chain-id', '1337'], {
        cwd: this.rootDir,
        stdio: 'ignore',
        detached: true,
      }).unref();

      // Wait for it to be ready
      for (let i = 0; i < 30; i++) {
        await this.sleep(500);
        if (await this.isLocalnetRunning()) {
          logger.success('Localnet running on port ' + LOCALNET_PORT);
          return true;
        }
      }

      logger.error('Localnet failed to start');
      return false;
    } catch (error) {
      logger.error('Failed to start localnet');
      logger.debug(String(error));
      return false;
    }
  }

  /**
   * Stop localnet
   */
  async stopLocalnet(): Promise<void> {
    await execa('pkill', ['-f', `anvil.*--port.*${LOCALNET_PORT}`], { reject: false });
  }

  /**
   * Get full infrastructure status
   */
  async getStatus(): Promise<InfrastructureStatus> {
    const docker = await this.isDockerRunning();
    const services = docker ? await this.checkServices() : [];
    const localnet = await this.isLocalnetRunning();
    
    const allHealthy = docker && 
      services.every(s => s.healthy) && 
      localnet;

    return {
      docker,
      services,
      localnet,
      allHealthy,
    };
  }

  /**
   * Ensure all infrastructure is running
   * Auto-starts what's missing
   */
  async ensureRunning(): Promise<boolean> {
    logger.header('INFRASTRUCTURE');

    // Step 1: Check/start Docker
    logger.subheader('Docker');
    
    if (!(await this.isDockerInstalled())) {
      logger.error('Docker is not installed');
      logger.info('  Install: https://docs.docker.com/get-docker/');
      return false;
    }

    if (!(await this.isDockerRunning())) {
      const started = await this.startDocker();
      if (!started) {
        return false;
      }
    } else {
      logger.success('Docker running');
    }

    // Step 2: Check/start Docker services
    logger.subheader('Services');
    
    let services = await this.checkServices();
    const unhealthyServices = services.filter(s => !s.healthy);
    
    if (unhealthyServices.length > 0) {
      logger.info(`Starting: ${unhealthyServices.map(s => s.name).join(', ')}`);
      const started = await this.startServices();
      if (!started) {
        return false;
      }
      services = await this.checkServices();
    } else {
      for (const service of services) {
        logger.success(`${service.name} healthy`);
      }
    }

    // Verify all services are healthy
    const stillUnhealthy = services.filter(s => !s.healthy);
    if (stillUnhealthy.length > 0) {
      logger.error(`Services not healthy: ${stillUnhealthy.map(s => s.name).join(', ')}`);
      return false;
    }

    // Step 3: Check/start localnet
    logger.subheader('Localnet');
    
    if (!(await this.isLocalnetRunning())) {
      const started = await this.startLocalnet();
      if (!started) {
        return false;
      }
    } else {
      logger.success('Localnet running on port ' + LOCALNET_PORT);
    }

    logger.newline();
    logger.success('All infrastructure ready');
    
    return true;
  }

  /**
   * Print status table
   */
  printStatus(status: InfrastructureStatus): void {
    logger.subheader('Infrastructure Status');

    logger.table([
      { label: 'Docker', value: status.docker ? 'running' : 'stopped', status: status.docker ? 'ok' : 'error' },
    ]);

    if (status.services.length > 0) {
      for (const service of status.services) {
        logger.table([
          { label: service.name, value: service.healthy ? service.url : 'not running', status: service.healthy ? 'ok' : 'error' },
        ]);
      }
    }

    logger.table([
      { label: 'Localnet', value: status.localnet ? `http://127.0.0.1:${LOCALNET_PORT}` : 'stopped', status: status.localnet ? 'ok' : 'error' },
    ]);
  }

  /**
   * Get environment variables for running services
   */
  getEnvVars(): Record<string, string> {
    return {
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      CQL_URL: 'http://127.0.0.1:4661',
      IPFS_API_URL: 'http://127.0.0.1:5001',
      DA_URL: 'http://127.0.0.1:4010',
      CACHE_URL: 'http://127.0.0.1:4115',
      CHAIN_ID: '1337',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function createInfrastructureService(rootDir: string): InfrastructureService {
  return new InfrastructureService(rootDir);
}

