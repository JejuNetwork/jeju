/**
 * Jeju Crucible - Multi-Agent Security Testing Platform
 * 
 * Proper ElizaOS Architecture:
 * - Creates multiple AgentRuntime instances (one per agent)
 * - All share one Postgres database
 * - All run in same Node process
 * - Each agent is independent but coordinated
 */

import { AgentRuntime, type Character, type IDatabaseAdapter, LogLevel } from '@elizaos/core';
import { PGLiteDatabaseAdapter } from '@elizaos/plugin-sql';
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap';
import { cruciblePlugin } from '../packages/plugin-crucible/src/index.js';
import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createA2ARouter } from './api/a2a.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ManagedAgent {
  id: string;
  name: string;
  type: string;
  runtime: AgentRuntime;
  wallet: string;
  character: Character;
}

class CrucibleManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private database: IDatabaseAdapter;
  private app: express.Application;

  constructor(database: IDatabaseAdapter) {
    this.database = database;
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.setupRoutes();
    // Add A2A routes
    this.app.use(createA2ARouter(this));
  }

  async createAgent(characterFile: string, name: string, wallet: string): Promise<ManagedAgent> {
    console.log(`Creating agent: ${name}...`);

    // Load character from JSON file
    const characterPath = path.join(__dirname, '../characters', characterFile);
    const characterData = await readFile(characterPath, 'utf-8');
    const character: Character = JSON.parse(characterData);

    // Override name and add wallet to secrets
    character.name = name;
    if (!character.settings) character.settings = {};
    if (!character.settings.secrets) character.settings.secrets = {};
    character.settings.secrets.REDTEAM_PRIVATE_KEY = wallet;

    // Inject environment secrets
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GUARDIAN_') || key.startsWith('JEJU_') || key.endsWith('_REGISTRY') || key.endsWith('_TOKEN')) {
        character.settings.secrets[key] = process.env[key];
      }
    }

    // Create AgentRuntime
    const runtime = new AgentRuntime({
      character,
      databaseAdapter: this.database,
      logLevel: (process.env.LOG_LEVEL as any) || LogLevel.INFO,
      plugins: [
        bootstrapPlugin,
        cruciblePlugin
      ]
    });

    // Initialize and start
    await runtime.initialize();
    await runtime.start();

    const agent: ManagedAgent = {
      id: `${character.settings?.secrets?.AGENT_TYPE || 'agent'}-${Date.now()}`,
      name,
      type: character.settings?.secrets?.AGENT_TYPE as string || 'unknown',
      runtime,
      wallet,
      character
    };

    this.agents.set(agent.id, agent);
    console.log(`   ✓ ${name} (${agent.type})`);

    return agent;
  }

  async seedDefaultAgents() {
    const agentConfigs = [
      {name: 'ShadowProbe', character: 'hacker.json', wallet: process.env.HACKER_WALLET_1!},
      {name: 'DefiHunter', character: 'hacker.json', wallet: process.env.HACKER_WALLET_2!},
      {name: 'SilkTongue', character: 'scammer.json', wallet: process.env.SCAMMER_WALLET_1!},
      {name: 'MarketTrick', character: 'scammer.json', wallet: process.env.SCAMMER_WALLET_2!},
      {name: 'Vigilant', character: 'citizen.json', wallet: process.env.CITIZEN_WALLET_1!},
      {name: 'Watchdog', character: 'citizen.json', wallet: process.env.CITIZEN_WALLET_2!},
      {name: 'Sentinel', character: 'citizen.json', wallet: process.env.CITIZEN_WALLET_3!},
      {name: 'JudicialMind', character: 'guardian.json', wallet: process.env.GUARDIAN_WALLET_1!},
      {name: 'TechnicalJudge', character: 'guardian.json', wallet: process.env.GUARDIAN_WALLET_2!},
      {name: 'CommunityGuard', character: 'guardian.json', wallet: process.env.GUARDIAN_WALLET_3!}
    ];

    for (const config of agentConfigs) {
      await this.createAgent(config.character, config.name, config.wallet);
    }
  }

  getAgents() {
    return Array.from(this.agents.values());
  }

  async stopAgent(id: string) {
    const agent = this.agents.get(id);
    if (agent) {
      await agent.runtime.stop();
      this.agents.delete(id);
    }
  }

  async stopAll() {
    for (const agent of this.agents.values()) {
      await agent.runtime.stop();
    }
    this.agents.clear();
  }

  private setupRoutes() {
    // Serve dashboard
    this.app.get('/dashboard', async (req, res) => {
      const dashboardPath = path.join(__dirname, '../public/dashboard.html');
      res.sendFile(dashboardPath);
    });

    // Root redirect
    this.app.get('/', (req, res) => {
      res.redirect('/dashboard');
    });

    // Agent list
    this.app.get('/api/agents', (req, res) => {
      const agents = this.getAgents().map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        wallet: a.wallet
      }));
      res.json(agents);
    });

    // Agent details
    this.app.get('/api/agents/:id', (req, res) => {
      const agent = this.agents.get(req.params.id);
      if (!agent) {
        return res.status(404).json({error: 'Agent not found'});
      }
      res.json({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        wallet: agent.wallet,
        character: agent.character.name
      });
    });

    // Crucible stats
    this.app.get('/api/crucible/stats', (req, res) => {
      const agents = this.getAgents();
      const byType = agents.reduce((acc: any, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
      }, {});

      res.json({
        totalAgents: agents.length,
        byType,
        vulnerabilitiesFound: 0, // TODO: Query from database
        reportsSubmitted: 0,
        fundsRecovered: '0 ETH'
      });
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        agents: this.agents.size,
        uptime: process.uptime()
      });
    });
    
    // Metrics API
    this.app.get('/api/crucible/metrics', (req, res) => {
      const allMetrics: any[] = [];
      
      for (const agent of this.agents.values()) {
        const loggerService = agent.runtime.getService('logger_service') as any;
        if (loggerService) {
          const stats = loggerService.getStatistics();
          allMetrics.push({
            agent: agent.name,
            type: agent.type,
            stats
          });
        }
      }
      
      res.json({
        agents: allMetrics,
        timestamp: Date.now()
      });
    });
    
    this.app.get('/api/crucible/metrics/:agentId', (req, res) => {
      const agent = this.agents.get(req.params.agentId);
      
      if (!agent) {
        return res.status(404).json({error: 'Agent not found'});
      }
      
      const loggerService = agent.runtime.getService('logger_service') as any;
      
      if (!loggerService) {
        return res.status(404).json({error: 'Logger service not available'});
      }
      
      const stats = loggerService.getStatistics();
      const allMetrics = loggerService.getAllMetrics();
      
      res.json({
        agent: agent.name,
        type: agent.type,
        statistics: stats,
        metrics: allMetrics,
        timestamp: Date.now()
      });
    });
  }

  listen(port: number) {
    return this.app.listen(port, () => {
      console.log(`🌐 API Server listening on http://localhost:${port}`);
      console.log(`   Agents: http://localhost:${port}/api/agents`);
      console.log(`   Metrics: http://localhost:${port}/api/crucible/metrics`);
      console.log(`   Dashboard: http://localhost:${port}/dashboard`);
    });
  }
}

async function main() {
  console.log('🔥 Jeju Crucible - Multi-Agent Security Testing Platform');
  console.log('   Platform: Desktop (Windows | macOS | Linux)');
  console.log('');

  // Validate network
  const network = process.env.NETWORK || 'localnet';
  if (network === 'mainnet') {
    throw new Error('❌ Crucible cannot run on mainnet');
  }

  console.log(`🌐 Network: ${network}`);
  console.log(`🛡️  Guardian: ${process.env.GUARDIAN_ADDRESS_LOCALNET}`);
  console.log('');

  // Create shared database
  const databaseUrl = process.env.DATABASE_URL || './data/crucible.db';
  console.log(`💾 Database: ${databaseUrl}`);
  
  const database = new PGLiteDatabaseAdapter({ dataDir: databaseUrl });
  await database.init();

  // Create manager
  const manager = new CrucibleManager(database);

  // Start API server
  const port = parseInt(process.env.SERVER_PORT || '7777');
  manager.listen(port);

  console.log('');

  // Create default agent swarm
  if (process.env.AUTO_START_AGENTS !== 'false') {
    console.log('🌱 Creating default agent swarm...');
    await manager.seedDefaultAgents();
    console.log('✅ Default swarm created');
    console.log('');
  }

  console.log('🎭 Agent Management API:');
  console.log(`   List:   GET http://localhost:${port}/api/agents`);
  console.log(`   Stats:  GET http://localhost:${port}/api/crucible/stats`);
  console.log(`   Health: GET http://localhost:${port}/api/health`);
  console.log('');
  console.log('🔐 Security Testing Active');
  console.log('Press Ctrl+C to stop');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await manager.stopAll();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { CrucibleManager };
