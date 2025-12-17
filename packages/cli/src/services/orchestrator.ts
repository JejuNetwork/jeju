/**
 * Services Orchestrator
 * 
 * Manages all local services for development:
 * - Inference (OpenAI/Claude/Groq wrapper)
 * - CQL (CovenantSQL database)
 * - Oracle (Price feeds)
 * - Indexer (GraphQL API)
 * - JNS (Name service mock)
 * - Storage (IPFS/file system)
 * - Cron triggers
 * - CVM (simulated via local dstack)
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { createInferenceServer, type LocalInferenceServer } from './inference';

export interface ServiceConfig {
  inference: boolean;
  cql: boolean;
  oracle: boolean;
  indexer: boolean;
  jns: boolean;
  storage: boolean;
  cron: boolean;
  cvm: boolean;
  computeBridge: boolean;
  git: boolean;
  pkg: boolean;
}

export interface RunningService {
  name: string;
  type: 'process' | 'server' | 'mock';
  port?: number;
  process?: Subprocess;
  server?: LocalInferenceServer | MockServer;
  url?: string;
  healthCheck?: string;
}

interface MockServer {
  stop(): Promise<void>;
}

const DEFAULT_PORTS = {
  inference: 4100,
  cql: 4300,
  oracle: 4301,
  indexer: 4350,
  jns: 4302,
  storage: 4030, // DWS main port
  cron: 4102,
  cvm: 4103,
  computeBridge: 4031, // DWS compute node port
  git: 4020,
  pkg: 4021, // JejuPkg registry (npm CLI compatible)
};

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    // Check if something is listening even if it doesn't respond to /health
    try {
      const server = Bun.serve({ port, fetch: () => new Response('') });
      server.stop();
      return false; // Port was free
    } catch {
      return true; // Port in use
    }
  }
}

class ServicesOrchestrator {
  private services: Map<string, RunningService> = new Map();
  private rootDir: string;
  private rpcUrl: string;

  constructor(rootDir: string, rpcUrl = 'http://localhost:9545') {
    this.rootDir = rootDir;
    this.rpcUrl = rpcUrl;
  }

  async startAll(config: Partial<ServiceConfig> = {}): Promise<void> {
    const enabledServices: ServiceConfig = {
      inference: config.inference ?? true,
      cql: config.cql ?? true,
      oracle: config.oracle ?? true,
      indexer: config.indexer ?? true,
      jns: config.jns ?? true,
      storage: config.storage ?? true, // DWS storage enabled by default
      cron: config.cron ?? true,
      cvm: config.cvm ?? false,
      computeBridge: config.computeBridge ?? true, // DWS compute enabled by default
      git: config.git ?? true,
      pkg: config.pkg ?? true,
    };

    logger.step('Starting development services...');

    // Start services in dependency order, skip if already running
    if (enabledServices.inference) await this.startInference();
    if (enabledServices.cql) await this.startCQL();
    if (enabledServices.oracle) await this.startOracle();
    if (enabledServices.indexer) await this.startIndexer();
    if (enabledServices.jns) await this.startJNS();
    if (enabledServices.storage) await this.startStorage();
    if (enabledServices.cron) await this.startCron();
    if (enabledServices.cvm) await this.startCVM();
    if (enabledServices.computeBridge) await this.startComputeBridge();
    if (enabledServices.git) await this.startGit();
    if (enabledServices.pkg) await this.startPkg();

    // Wait for services to be ready
    await this.waitForServices();
    this.printStatus();
  }

  private async startInference(): Promise<void> {
    const port = DEFAULT_PORTS.inference;
    
    // Check if already running
    if (await isPortInUse(port)) {
      logger.info(`Inference already running on port ${port}`);
      this.services.set('inference', {
        name: 'Inference',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    const server = createInferenceServer({ port });
    await server.start();

    this.services.set('inference', {
      name: 'Inference',
      type: 'server',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });
  }

  private async startCQL(): Promise<void> {
    const port = DEFAULT_PORTS.cql;
    
    // Check if already running
    if (await isPortInUse(port)) {
      logger.info(`CQL already running on port ${port}`);
      this.services.set('cql', {
        name: 'CQL',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    // Start SQLite-backed CQL server from packages/db
    const dbPath = join(this.rootDir, 'packages/db');
    const dataDir = join(this.rootDir, '.data/cql');
    
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const proc = spawn({
      cmd: ['bun', 'run', 'server'],
      cwd: dbPath,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
        CQL_PORT: String(port),
        CQL_DATA_DIR: dataDir,
        CQL_DEBUG: 'true',
      },
    });

    this.services.set('cql', {
      name: 'CQL (SQLite)',
      type: 'process',
      port,
      process: proc,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });

    logger.success(`CQL database starting on port ${port} (data: ${dataDir})`);
  }

  private async startOracle(): Promise<void> {
    const port = DEFAULT_PORTS.oracle;
    
    if (await isPortInUse(port)) {
      logger.info(`Oracle already running on port ${port}`);
      this.services.set('oracle', {
        name: 'Oracle',
        type: 'mock',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    const server = await this.createMockOracle();
    this.services.set('oracle', {
      name: 'Oracle (Mock)',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });
    logger.info(`Oracle mock service on port ${port}`);
  }

  private async createMockOracle(): Promise<MockServer> {
    const port = DEFAULT_PORTS.oracle;
    const rpcUrl = this.rpcUrl;

    // Simulated price data with realistic volatility
    const basePrices: Record<string, number> = {
      'ETH/USD': 3500,
      'BTC/USD': 95000,
      'JEJU/USD': 1.25,
      'USDC/USD': 1.0,
      'DAI/USD': 1.0,
      'WETH/USD': 3500,
      'WBTC/USD': 95000,
    };

    // Add small random variation to simulate real oracle
    const getPrice = (pair: string) => {
      const base = basePrices[pair];
      if (!base) return null;
      // +/- 0.1% variation
      const variation = 1 + (Math.random() - 0.5) * 0.002;
      return {
        price: Math.round(base * variation * 100) / 100,
        timestamp: Date.now(),
        source: 'jeju-oracle-simulator',
        confidence: 0.99,
      };
    };

    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({ 
            status: 'ok', 
            mode: 'simulator',
            rpcUrl,
            supportedPairs: Object.keys(basePrices),
          });
        }

        if (url.pathname === '/api/v1/prices') {
          const pair = url.searchParams.get('pair');
          if (pair) {
            const priceData = getPrice(pair);
            if (priceData) return Response.json(priceData);
            return Response.json({ error: 'Pair not found' }, { status: 404 });
          }
          // Return all prices
          const allPrices: Record<string, object> = {};
          for (const p of Object.keys(basePrices)) {
            allPrices[p] = getPrice(p)!;
          }
          return Response.json(allPrices);
        }

        if (url.pathname === '/api/v1/price' && req.method === 'GET') {
          const base = url.searchParams.get('base') || 'ETH';
          const quote = url.searchParams.get('quote') || 'USD';
          const pair = `${base}/${quote}`;
          const priceData = getPrice(pair);
          if (priceData) {
            return Response.json({ pair, ...priceData });
          }
          return Response.json({ error: 'Pair not found' }, { status: 404 });
        }

        // Chainlink-compatible aggregator format
        if (url.pathname === '/api/v1/latestRoundData') {
          const pair = url.searchParams.get('pair') || 'ETH/USD';
          const priceData = getPrice(pair);
          if (priceData) {
            return Response.json({
              roundId: BigInt(Date.now()).toString(),
              answer: BigInt(Math.round(priceData.price * 1e8)).toString(), // 8 decimals
              startedAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
              answeredInRound: BigInt(Date.now()).toString(),
            });
          }
          return Response.json({ error: 'Pair not found' }, { status: 404 });
        }

        if (url.pathname === '/metrics') {
          const metrics = [
            '# HELP oracle_price_updates_total Total price updates',
            '# TYPE oracle_price_updates_total counter',
            'oracle_price_updates_total 1000',
            '# HELP oracle_last_update_timestamp Last price update timestamp',
            '# TYPE oracle_last_update_timestamp gauge',
            `oracle_last_update_timestamp ${Date.now()}`,
          ].join('\n');
          return new Response(metrics, { headers: { 'Content-Type': 'text/plain' } });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startIndexer(): Promise<void> {
    const indexerPath = join(this.rootDir, 'apps/indexer');
    if (!existsSync(indexerPath)) {
      logger.warn('Indexer not found, skipping');
      return;
    }

    // Check if Docker is available for PostgreSQL
    try {
      const result = await Bun.spawn(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exited;
      if (result !== 0) {
        logger.warn('Docker not available, using mock indexer');
        await this.startMockIndexer();
        return;
      }
    } catch {
      logger.warn('Docker not available, using mock indexer');
      await this.startMockIndexer();
      return;
    }

    // Start PostgreSQL via docker-compose
    const dbProc = spawn({
      cmd: ['docker', 'compose', 'up', '-d', 'db'],
      cwd: indexerPath,
      stdout: 'ignore',
      stderr: 'ignore',
    });

    await dbProc.exited;

    // Start indexer
    const proc = spawn({
      cmd: ['bun', 'run', 'dev'],
      cwd: indexerPath,
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        ...process.env,
        GQL_PORT: String(DEFAULT_PORTS.indexer),
        RPC_ETH_HTTP: this.rpcUrl,
        START_BLOCK: '0',
        CHAIN_ID: '1337',
      },
    });

    this.services.set('indexer', {
      name: 'Indexer',
      type: 'process',
      port: DEFAULT_PORTS.indexer,
      process: proc,
      url: `http://localhost:${DEFAULT_PORTS.indexer}/graphql`,
      healthCheck: '/graphql',
    });

    logger.success(`Indexer starting on port ${DEFAULT_PORTS.indexer}`);
  }

  private async startMockIndexer(): Promise<void> {
    const port = DEFAULT_PORTS.indexer;

    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health' || url.pathname === '/graphql') {
          if (req.method === 'GET') {
            return Response.json({ status: 'ok', mock: true });
          }
          // Handle GraphQL POST
          return Response.json({
            data: {
              blocks: [],
              transactions: [],
              accounts: [],
            },
          });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    this.services.set('indexer', {
      name: 'Indexer (Mock)',
      type: 'mock',
      port,
      server: { stop: async () => server.stop() },
      url: `http://localhost:${port}/graphql`,
      healthCheck: '/graphql',
    });

    logger.info(`Indexer mock service on port ${port}`);
  }

  private async startJNS(): Promise<void> {
    const port = DEFAULT_PORTS.jns;
    
    if (await isPortInUse(port)) {
      logger.info(`JNS already running on port ${port}`);
      this.services.set('jns', {
        name: 'JNS',
        type: 'mock',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    const server = await this.createMockJNS();
    this.services.set('jns', {
      name: 'JNS (Mock)',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });
    logger.info(`JNS mock service on port ${port}`);
  }

  private async createMockJNS(): Promise<MockServer> {
    const port = DEFAULT_PORTS.jns;
    const rpcUrl = this.rpcUrl;
    
    // In-memory registry (simulates on-chain state)
    const names = new Map<string, { 
      owner: string; 
      resolver: string; 
      records: Record<string, string>;
      registeredAt: number;
      expiresAt: number;
    }>();

    // Pre-populate with core network names (simulating genesis registrations)
    const coreNames = [
      'wallet.jeju', 'bazaar.jeju', 'gateway.jeju', 'indexer.jeju', 
      'storage.jeju', 'oracle.jeju', 'council.jeju', 'compute.jeju',
    ];
    const now = Date.now();
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    
    for (const name of coreNames) {
      names.set(name, {
        owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Dev deployer
        resolver: '0x0000000000000000000000000000000000000001',
        records: { 
          addr: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          'app.contract': '0x0000000000000000000000000000000000000000',
        },
        registeredAt: now,
        expiresAt: now + (10 * oneYear), // 10 years for core names
      });
    }

    // Compute name hash (ENS-compatible)
    const namehash = (name: string): string => {
      const labels = name.split('.');
      let node = '0x' + '00'.repeat(32);
      for (let i = labels.length - 1; i >= 0; i--) {
        const labelHash = Bun.hash(labels[i]).toString(16).padStart(64, '0');
        node = Bun.hash(node + labelHash).toString(16).padStart(64, '0');
      }
      return '0x' + node;
    };

    // Price calculation based on name length and duration
    const calculatePrice = (name: string, years: number): { pricePerYear: number; total: number; currency: string } => {
      const label = name.split('.')[0];
      const length = label.length;
      let pricePerYear: number;
      
      if (length === 1) pricePerYear = 500;      // 1 char: 500 JEJU/year
      else if (length === 2) pricePerYear = 200; // 2 char: 200 JEJU/year
      else if (length === 3) pricePerYear = 100; // 3 char: 100 JEJU/year
      else if (length === 4) pricePerYear = 50;  // 4 char: 50 JEJU/year
      else if (length <= 7) pricePerYear = 20;   // 5-7 char: 20 JEJU/year
      else pricePerYear = 10;                    // 8+ char: 10 JEJU/year
      
      return {
        pricePerYear,
        total: pricePerYear * years,
        currency: 'JEJU',
      };
    };

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({ 
            status: 'ok', 
            mode: 'simulator',
            rpcUrl,
            registeredNames: names.size,
            coreNames: coreNames.length,
          });
        }

        // Resolve name to address and records
        if (url.pathname === '/api/v1/resolve') {
          const name = url.searchParams.get('name');
          if (!name) return Response.json({ error: 'Name required' }, { status: 400 });
          
          if (names.has(name)) {
            const data = names.get(name)!;
            const isExpired = data.expiresAt < Date.now();
            return Response.json({ 
              name, 
              node: namehash(name),
              ...data,
              isExpired,
              isAvailable: false,
            });
          }
          return Response.json({ 
            error: 'Name not found',
            name,
            isAvailable: true,
          }, { status: 404 });
        }

        // Reverse resolve address to name
        if (url.pathname === '/api/v1/reverse') {
          const address = url.searchParams.get('address')?.toLowerCase();
          if (!address) return Response.json({ error: 'Address required' }, { status: 400 });
          
          for (const [name, data] of names) {
            if (data.records.addr?.toLowerCase() === address) {
              return Response.json({ address, name, records: data.records });
            }
          }
          return Response.json({ error: 'No reverse record', address }, { status: 404 });
        }

        // Check availability
        if (url.pathname === '/api/v1/available') {
          const name = url.searchParams.get('name');
          if (!name) return Response.json({ error: 'Name required' }, { status: 400 });
          
          const existing = names.get(name);
          const isAvailable = !existing || existing.expiresAt < Date.now();
          return Response.json({ 
            name, 
            available: isAvailable,
            ...(existing && { currentOwner: existing.owner, expiresAt: existing.expiresAt }),
          });
        }

        // Register a name
        if (url.pathname === '/api/v1/register' && req.method === 'POST') {
          const body = await req.json() as { name: string; owner: string; years?: number; resolver?: string; records?: Record<string, string> };
          const { name, owner, years = 1, resolver, records } = body;
          
          if (!name || !owner) {
            return Response.json({ error: 'Name and owner required' }, { status: 400 });
          }
          
          const existing = names.get(name);
          if (existing && existing.expiresAt > Date.now()) {
            return Response.json({ error: 'Name not available' }, { status: 409 });
          }
          
          const pricing = calculatePrice(name, years);
          
          names.set(name, {
            owner,
            resolver: resolver || '0x0000000000000000000000000000000000000001',
            records: records || { addr: owner },
            registeredAt: Date.now(),
            expiresAt: Date.now() + (years * oneYear),
          });
          
          return Response.json({ 
            success: true, 
            name,
            node: namehash(name),
            ...pricing,
            expiresAt: Date.now() + (years * oneYear),
          });
        }

        // Renew a name
        if (url.pathname === '/api/v1/renew' && req.method === 'POST') {
          const body = await req.json() as { name: string; years?: number };
          const { name, years = 1 } = body;
          
          const existing = names.get(name);
          if (!existing) {
            return Response.json({ error: 'Name not found' }, { status: 404 });
          }
          
          const pricing = calculatePrice(name, years);
          existing.expiresAt = Math.max(existing.expiresAt, Date.now()) + (years * oneYear);
          
          return Response.json({
            success: true,
            name,
            ...pricing,
            newExpiresAt: existing.expiresAt,
          });
        }

        // Update records
        if (url.pathname === '/api/v1/setRecords' && req.method === 'POST') {
          const body = await req.json() as { name: string; records: Record<string, string> };
          const { name, records } = body;
          
          const existing = names.get(name);
          if (!existing) {
            return Response.json({ error: 'Name not found' }, { status: 404 });
          }
          
          existing.records = { ...existing.records, ...records };
          return Response.json({ success: true, name, records: existing.records });
        }

        // List names for owner
        if (url.pathname === '/api/v1/names') {
          const owner = url.searchParams.get('owner');
          const result = [];
          for (const [name, data] of names) {
            if (!owner || data.owner.toLowerCase() === owner.toLowerCase()) {
              result.push({ 
                name, 
                node: namehash(name),
                ...data,
                isExpired: data.expiresAt < Date.now(),
              });
            }
          }
          return Response.json({ names: result, total: result.length });
        }

        // Get pricing
        if (url.pathname === '/api/v1/price') {
          const name = url.searchParams.get('name') || '';
          const years = parseInt(url.searchParams.get('years') || '1');
          
          if (!name) return Response.json({ error: 'Name required' }, { status: 400 });
          
          const pricing = calculatePrice(name, years);
          const existing = names.get(name);
          
          return Response.json({
            name,
            years,
            ...pricing,
            available: !existing || existing.expiresAt < Date.now(),
            ...(existing && { currentOwner: existing.owner, expiresAt: existing.expiresAt }),
          });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startStorage(): Promise<void> {
    const port = DEFAULT_PORTS.storage;
    
    if (await isPortInUse(port)) {
      logger.info(`DWS already running on port ${port}`);
      this.services.set('storage', {
        name: 'DWS',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    const dwsPath = join(this.rootDir, 'apps/dws');

    if (!existsSync(dwsPath)) {
      logger.warn('DWS app not found, skipping storage');
      return;
    }

    const proc = spawn({
      cmd: ['bun', 'run', 'dev'],
      cwd: dwsPath,
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        DWS_PORT: String(port),
        RPC_URL: this.rpcUrl,
      },
    });

    this.services.set('storage', {
      name: 'DWS',
      type: 'process',
      port,
      process: proc,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });

    logger.success(`DWS service starting on port ${port}`);
  }

  private async startCron(): Promise<void> {
    const port = DEFAULT_PORTS.cron;
    
    if (await isPortInUse(port)) {
      logger.info(`Cron already running on port ${port}`);
      this.services.set('cron', {
        name: 'Cron',
        type: 'mock',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    const server = await this.createMockCron();
    this.services.set('cron', {
      name: 'Cron (Mock)',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });
    logger.info(`Cron mock service on port ${port}`);
  }

  private async createMockCron(): Promise<MockServer> {
    const port = DEFAULT_PORTS.cron;
    const jobs: Array<{ id: string; cron: string; callback: string; enabled: boolean }> = [];

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', mock: true });
        }

        if (url.pathname === '/api/v1/jobs') {
          if (req.method === 'GET') {
            return Response.json({ jobs });
          }
          if (req.method === 'POST') {
            const body = await req.json() as { cron: string; callback: string };
            const job = {
              id: `job-${Date.now()}`,
              cron: body.cron,
              callback: body.callback,
              enabled: true,
            };
            jobs.push(job);
            return Response.json(job);
          }
        }

        if (url.pathname.startsWith('/api/v1/jobs/') && req.method === 'DELETE') {
          const id = url.pathname.split('/').pop();
          const idx = jobs.findIndex((j) => j.id === id);
          if (idx >= 0) {
            jobs.splice(idx, 1);
            return Response.json({ success: true });
          }
          return Response.json({ error: 'Job not found' }, { status: 404 });
        }

        if (url.pathname === '/api/v1/trigger' && req.method === 'POST') {
          const body = await req.json() as { jobId: string };
          // Simulate trigger execution
          return Response.json({ triggered: body.jobId, timestamp: Date.now() });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startCVM(): Promise<void> {
    const dstackPath = join(this.rootDir, 'vendor/dstack');

    if (!existsSync(dstackPath)) {
      // Create mock CVM service
      const server = await this.createMockCVM();
      this.services.set('cvm', {
        name: 'CVM (Mock)',
        type: 'mock',
        port: DEFAULT_PORTS.cvm,
        server,
        url: `http://localhost:${DEFAULT_PORTS.cvm}`,
        healthCheck: '/health',
      });
      logger.info(`CVM mock service on port ${DEFAULT_PORTS.cvm}`);
      return;
    }

    // Start dstack simulator
    const proc = spawn({
      cmd: ['bun', 'run', 'dev:simulator'],
      cwd: dstackPath,
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        ...process.env,
        PORT: String(DEFAULT_PORTS.cvm),
      },
    });

    this.services.set('cvm', {
      name: 'CVM (dstack)',
      type: 'process',
      port: DEFAULT_PORTS.cvm,
      process: proc,
      url: `http://localhost:${DEFAULT_PORTS.cvm}`,
      healthCheck: '/health',
    });

    logger.success(`CVM service starting on port ${DEFAULT_PORTS.cvm}`);
  }

  private async createMockCVM(): Promise<MockServer> {
    const port = DEFAULT_PORTS.cvm;
    const vms: Array<{ id: string; status: string; image: string }> = [];

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', mock: true, tee: false });
        }

        if (url.pathname === '/api/v1/vms') {
          if (req.method === 'GET') {
            return Response.json({ vms });
          }
          if (req.method === 'POST') {
            const body = await req.json() as { image: string };
            const vm = {
              id: `vm-${Date.now()}`,
              status: 'running',
              image: body.image,
            };
            vms.push(vm);
            return Response.json(vm);
          }
        }

        if (url.pathname.startsWith('/api/v1/vms/') && req.method === 'DELETE') {
          const id = url.pathname.split('/').pop();
          const idx = vms.findIndex((v) => v.id === id);
          if (idx >= 0) {
            vms.splice(idx, 1);
            return Response.json({ success: true });
          }
          return Response.json({ error: 'VM not found' }, { status: 404 });
        }

        if (url.pathname === '/api/v1/attestation') {
          return Response.json({
            teeType: 'mock',
            attestation: null,
            verified: false,
            message: 'Running in mock mode without TEE',
          });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startComputeBridge(): Promise<void> {
    const port = DEFAULT_PORTS.computeBridge;
    
    if (await isPortInUse(port)) {
      logger.info(`DWS Compute Node already running on port ${port}`);
      this.services.set('computeBridge', {
        name: 'DWS Compute',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      });
      return;
    }

    // Create mock compute node for dev
    const server = await this.createMockCompute();
    this.services.set('computeBridge', {
      name: 'DWS Compute',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    });
    logger.info(`DWS Compute mock service on port ${port}`);
  }

  private async createMockCompute(): Promise<MockServer> {
    const port = DEFAULT_PORTS.computeBridge;
    const jobs = new Map<string, { id: string; status: string; result?: string }>();

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({ 
            status: 'healthy', 
            service: 'dws-compute',
            mode: 'simulator',
            providers: 1,
          });
        }

        // Inference endpoint
        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = await req.json() as { messages?: Array<{ content: string }>; model?: string };
          return Response.json({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'gpt-4',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'This is a mock response from DWS compute in dev mode.',
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          });
        }

        // Embeddings endpoint
        if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
          return Response.json({
            object: 'list',
            data: [{
              object: 'embedding',
              index: 0,
              embedding: Array.from({ length: 1536 }, () => Math.random() * 2 - 1),
            }],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 10, total_tokens: 10 },
          });
        }

        // Job submission
        if (url.pathname === '/api/v1/jobs' && req.method === 'POST') {
          await req.json() as { command?: string; image?: string };
          const jobId = `job-${Date.now()}`;
          jobs.set(jobId, { id: jobId, status: 'completed', result: 'Mock job completed' });
          return Response.json({ jobId, status: 'queued' });
        }

        // Job status
        if (url.pathname.startsWith('/api/v1/jobs/') && req.method === 'GET') {
          const jobId = url.pathname.split('/').pop();
          const job = jobs.get(jobId || '');
          if (job) {
            return Response.json(job);
          }
          return Response.json({ error: 'Job not found' }, { status: 404 });
        }

        // Provider listing
        if (url.pathname === '/api/v1/providers') {
          return Response.json({
            providers: [{
              id: 'local-dev',
              address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
              available: true,
              models: ['gpt-5.2', 'gpt-4o-mini', 'claude-opus-4-5-20251101'],
              pricing: { perToken: '0.0001' },
            }],
          });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startGit(): Promise<void> {
    const port = DEFAULT_PORTS.git;
    
    if (await isPortInUse(port)) {
      logger.info(`JejuGit already running on port ${port}`);
      this.services.set('git', {
        name: 'JejuGit',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/git/health',
      });
      return;
    }

    // Git is now part of DWS - check if DWS is running
    const dwsPort = DEFAULT_PORTS.storage;
    if (await isPortInUse(dwsPort)) {
      // DWS is running, Git is available at /git routes
      this.services.set('git', {
        name: 'JejuGit (via DWS)',
        type: 'server',
        port: dwsPort,
        url: `http://localhost:${dwsPort}/git`,
        healthCheck: '/git/health',
      });
      logger.info(`JejuGit available via DWS on port ${dwsPort}`);
      return;
    }

    // Create mock git server for standalone testing
    const server = await this.createMockGit();
    this.services.set('git', {
      name: 'JejuGit (Mock)',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/api/v1/health',
    });
    logger.info(`JejuGit mock service on port ${port}`);
  }

  private async createMockGit(): Promise<MockServer> {
    const port = DEFAULT_PORTS.git;
    const repositories = new Map<string, { name: string; owner: string; description: string; stars: number; visibility: string }>();

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/api/v1/health') {
          return Response.json({ 
            status: 'ok', 
            mock: true,
            storageBackend: 'memory',
            totalRepositories: repositories.size,
          });
        }

        if (url.pathname === '/api/v1/repos') {
          if (req.method === 'GET') {
            return Response.json({ 
              total_count: repositories.size,
              items: Array.from(repositories.values()).map(r => ({
                id: `${r.owner}/${r.name}`,
                name: r.name,
                full_name: `${r.owner}/${r.name}`,
                owner: { login: r.owner },
                description: r.description,
                visibility: r.visibility,
                stargazers_count: r.stars,
                forks_count: 0,
                default_branch: 'main',
                topics: [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })),
            });
          }
          if (req.method === 'POST') {
            const body = await req.json() as { name: string; description?: string; visibility?: string };
            const owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
            const repo = {
              name: body.name,
              owner,
              description: body.description || '',
              stars: 0,
              visibility: body.visibility || 'public',
            };
            repositories.set(`${owner}/${body.name}`, repo);
            return Response.json({
              id: `${owner}/${body.name}`,
              repoName: body.name,
              full_name: `${owner}/${body.name}`,
              ...repo,
            }, { status: 201 });
          }
        }

        // Match repo routes
        const repoMatch = url.pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/);
        if (repoMatch) {
          const repoId = `${repoMatch[1]}/${repoMatch[2]}`;
          const repo = repositories.get(repoId);
          if (repo) {
            return Response.json({
              id: repoId,
              name: repo.name,
              full_name: repoId,
              owner: { login: repo.owner },
              description: repo.description,
              visibility: repo.visibility,
              stargazers_count: repo.stars,
              forks_count: 0,
              default_branch: 'main',
            });
          }
          return Response.json({ error: 'Repository not found' }, { status: 404 });
        }

        // Git info/refs (for git clone)
        if (url.pathname.endsWith('/info/refs')) {
          return Response.json({ error: 'Mock git server - use API' }, { status: 501 });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async startPkg(): Promise<void> {
    const port = DEFAULT_PORTS.pkg;
    
    if (await isPortInUse(port)) {
      logger.info(`JejuPkg already running on port ${port}`);
      this.services.set('pkg', {
        name: 'JejuPkg',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/pkg/health', // JejuPkg registry endpoint
      });
      return;
    }

    // Pkg registry is now part of DWS - check if DWS is running
    const dwsPort = DEFAULT_PORTS.storage;
    if (await isPortInUse(dwsPort)) {
      // DWS is running, pkg registry is available at /pkg routes (npm CLI compatible)
      this.services.set('pkg', {
        name: 'JejuPkg (via DWS)',
        type: 'server',
        port: dwsPort,
        url: `http://localhost:${dwsPort}/pkg`,
        healthCheck: '/pkg/health', // JejuPkg registry endpoint
      });
      logger.info(`JejuPkg available via DWS on port ${dwsPort}`);
      return;
    }

    // Create mock pkg registry for standalone testing
    const server = await this.createMockPkg();
    this.services.set('pkg', {
      name: 'JejuPkg (Mock)',
      type: 'mock',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/-/registry/health',
    });
    logger.info(`JejuPkg mock service on port ${port}`);
  }

  private async createMockPkg(): Promise<MockServer> {
    const port = DEFAULT_PORTS.pkg;
    const packages = new Map<string, { name: string; versions: Record<string, object>; 'dist-tags': Record<string, string> }>();

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/-/registry/health') {
          return Response.json({ 
            status: 'ok', 
            mock: true,
            storageBackend: 'memory',
            totalPackages: packages.size,
          });
        }

        if (url.pathname === '/') {
          return Response.json({
            db_name: 'jeju-registry',
            doc_count: packages.size,
          });
        }

        // Search
        if (url.pathname === '/-/v1/search') {
          const text = url.searchParams.get('text') || '';
          const results = Array.from(packages.values())
            .filter(p => p.name.includes(text))
            .map(p => ({
              package: {
                name: p.name,
                version: p['dist-tags'].latest,
                description: '',
              },
              score: { final: 0.5 },
            }));
          return Response.json({ objects: results, total: results.length });
        }

        // Get package
        const pkgMatch = url.pathname.match(/^\/([^/]+(?:\/[^/]+)?)$/);
        if (pkgMatch && req.method === 'GET') {
          const pkgName = decodeURIComponent(pkgMatch[1]);
          const pkg = packages.get(pkgName);
          if (pkg) {
            return Response.json(pkg);
          }
          return Response.json({ error: 'not_found' }, { status: 404 });
        }

        // Publish package
        if (pkgMatch && req.method === 'PUT') {
          const pkgName = decodeURIComponent(pkgMatch[1]);
          const body = await req.json() as {
            name: string;
            versions: Record<string, object>;
            'dist-tags': Record<string, string>;
          };
          packages.set(pkgName, {
            name: body.name,
            versions: body.versions,
            'dist-tags': body['dist-tags'],
          });
          return Response.json({ ok: true, id: pkgName }, { status: 201 });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    return {
      stop: async () => server.stop(),
    };
  }

  private async waitForServices(): Promise<void> {
    const maxWait = 30000;
    const startTime = Date.now();

    for (const [name, service] of this.services) {
      if (!service.healthCheck || !service.url) continue;

      const healthUrl = `${service.url}${service.healthCheck}`;
      let ready = false;

      while (Date.now() - startTime < maxWait && !ready) {
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
          if (response.ok) {
            ready = true;
          }
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      if (!ready) {
        logger.warn(`Service ${name} health check failed`);
      }
    }
  }

  printStatus(): void {
    logger.newline();
    logger.subheader('Development Services');

    const sortOrder = ['inference', 'cql', 'oracle', 'indexer', 'jns', 'storage', 'cron', 'cvm', 'computeBridge', 'git', 'pkg'];
    const sorted = Array.from(this.services.entries()).sort(
      ([a], [b]) => sortOrder.indexOf(a) - sortOrder.indexOf(b)
    );

    for (const [_key, service] of sorted) {
      logger.table([
        {
          label: service.name,
          value: service.url || 'running',
          status: 'ok',
        },
      ]);
    }
  }

  getServiceUrl(name: string): string | undefined {
    return this.services.get(name)?.url;
  }

  async stopAll(): Promise<void> {
    logger.step('Stopping services...');

    for (const [name, service] of this.services) {
      try {
        if (service.type === 'process' && service.process) {
          service.process.kill();
        }
        if ((service.type === 'server' || service.type === 'mock') && service.server) {
          await service.server.stop();
        }
        logger.info(`Stopped ${name}`);
      } catch (error) {
        logger.warn(`Failed to stop ${name}: ${error}`);
      }
    }

    this.services.clear();
  }

  getRunningServices(): Map<string, RunningService> {
    return this.services;
  }

  getEnvVars(): Record<string, string> {
    const env: Record<string, string> = {};

    const inference = this.services.get('inference');
    if (inference) {
      env.JEJU_INFERENCE_URL = inference.url!;
      env.VITE_JEJU_GATEWAY_URL = inference.url!;
    }

    const cql = this.services.get('cql');
    if (cql) {
      env.CQL_BLOCK_PRODUCER_ENDPOINT = cql.url!;
    }

    const oracle = this.services.get('oracle');
    if (oracle) {
      env.ORACLE_URL = oracle.url!;
    }

    const indexer = this.services.get('indexer');
    if (indexer) {
      env.INDEXER_GRAPHQL_URL = indexer.url!;
    }

    const jns = this.services.get('jns');
    if (jns) {
      env.JNS_API_URL = jns.url!;
    }

    const storage = this.services.get('storage');
    if (storage) {
      env.JEJU_STORAGE_URL = storage.url!;
      env.DWS_URL = storage.url!;
      env.STORAGE_API_URL = `${storage.url}/storage`;
      env.IPFS_GATEWAY = `${storage.url}/cdn`;
    }

    const cron = this.services.get('cron');
    if (cron) {
      env.CRON_SERVICE_URL = cron.url!;
    }

    const cvm = this.services.get('cvm');
    if (cvm) {
      env.DSTACK_ENDPOINT = cvm.url!;
    }

    const computeBridge = this.services.get('computeBridge');
    if (computeBridge) {
      env.COMPUTE_BRIDGE_URL = computeBridge.url!;
      env.JEJU_COMPUTE_BRIDGE_URL = computeBridge.url!;
      env.COMPUTE_MARKETPLACE_URL = computeBridge.url!;
    }

    const git = this.services.get('git');
    if (git) {
      // Git is part of DWS, but expose both URLs for compatibility
      env.JEJUGIT_URL = git.url!;
      env.NEXT_PUBLIC_JEJUGIT_URL = git.url!;
    }

    const pkg = this.services.get('pkg');
    if (pkg) {
      // Pkg registry is part of DWS, but expose both URLs for compatibility
      env.JEJUPKG_URL = pkg.url!;
      env.NEXT_PUBLIC_JEJUPKG_URL = pkg.url!;
      // For npm CLI configuration (backwards compatibility)
      env.npm_config_registry = pkg.url!;
    }

    // DWS provides both Git and Pkg registry - expose unified URL
    if (storage) {
      env.DWS_GIT_URL = `${storage.url}/git`;
      env.DWS_PKG_URL = `${storage.url}/pkg`;
      // Backwards compatibility alias
      env.DWS_NPM_URL = `${storage.url}/pkg`;
    }

    return env;
  }

  // Generate a .env.local file for apps
  generateEnvFile(outputPath: string): void {
    const envVars = this.getEnvVars();
    const content = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    mkdirSync(join(outputPath, '..'), { recursive: true });
    writeFileSync(outputPath, content + '\n');
    logger.info(`Generated env file: ${outputPath}`);
  }
}

export const createOrchestrator = (rootDir: string, rpcUrl?: string) =>
  new ServicesOrchestrator(rootDir, rpcUrl);
export { ServicesOrchestrator };

