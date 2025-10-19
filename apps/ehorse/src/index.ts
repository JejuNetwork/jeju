/**
 * eHorse Racing Game Server
 * Minimal horse racing game for prediction markets
 */

import express from 'express';
import cors from 'cors';
import { RaceEngine } from './game.js';
import { A2AServer } from './a2a.js';
import { OraclePublisher } from './oracle.js';
import { RegistryClient } from './registry.js';
import { MarketCreator } from './market-creator.js';

const PORT = parseInt(process.env.EHORSE_PORT || '5700');
const SERVER_URL = process.env.EHORSE_SERVER_URL || `http://localhost:${PORT}`;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.EHORSE_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
const ORACLE_ADDRESS = process.env.PREDICTION_ORACLE_ADDRESS || '';
const MARKET_FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS || '';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize components
const raceEngine = new RaceEngine();
const a2aServer = new A2AServer(raceEngine, SERVER_URL);

let oraclePublisher: OraclePublisher | null = null;
let registryClient: RegistryClient | null = null;
let marketCreator: MarketCreator | null = null;

// Optional: Oracle integration
if (ORACLE_ADDRESS && PRIVATE_KEY) {
  oraclePublisher = new OraclePublisher({
    rpcUrl: RPC_URL,
    oracleAddress: ORACLE_ADDRESS,
    privateKey: PRIVATE_KEY
  });
  console.log('✅ Oracle publisher enabled');

  // Set up race callbacks for oracle publishing
  raceEngine.setRaceCallbacks(
    async (raceId: string, predeterminedWinner: number) => {
      // Commit race when it starts
      await oraclePublisher!.commitRace(raceId, predeterminedWinner);
    },
    async (raceId: string, winner: number) => {
      // Reveal race when it finishes
      await oraclePublisher!.revealRace(raceId, winner);
    }
  );
}

// Optional: ERC-8004 registration (disabled for now)
// if (PRIVATE_KEY) {
//   registryClient = new RegistryClient(RPC_URL, PRIVATE_KEY);
//   registryClient.initialize().then(() => {
//     if (registryClient?.isEnabled()) {
//       registryClient.registerGame('ehorse', SERVER_URL);
//     }
//   });
// }

// Optional: Market creator (auto-creates markets on Predimarket)
if (MARKET_FACTORY_ADDRESS && ORACLE_ADDRESS && PRIVATE_KEY) {
  marketCreator = new MarketCreator({
    rpcUrl: RPC_URL,
    marketFactoryAddress: MARKET_FACTORY_ADDRESS,
    oracleAddress: ORACLE_ADDRESS,
    privateKey: PRIVATE_KEY
  });
  
  marketCreator.startWatching().then(() => {
    console.log('✅ Market creator enabled - markets will auto-create');
  }).catch(err => {
    console.error('⚠️  Market creator failed to start:', err.message);
  });
}

// Mount A2A router
app.use('/', a2aServer.createRouter());

// REST API for frontend
app.get('/api/race', (_req, res) => {
  const race = raceEngine.getCurrentRace();
  res.json(race);
});

app.get('/api/horses', (_req, res) => {
  res.json({ horses: raceEngine.getHorses() });
});

app.get('/api/history', (_req, res) => {
  res.json({ races: raceEngine.getRaceHistory() });
});

// On-chain state viewer
app.get('/state', (_req, res) => {
  res.sendFile('state-panel.html', { root: 'public' });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ehorse',
    race: raceEngine.getCurrentRace()?.id,
    oracle: oraclePublisher?.isEnabled() || false,
    registry: registryClient?.isEnabled() || false,
    marketCreator: marketCreator !== null
  });
});

// Oracle publishing is now handled via race callbacks

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🐴 eHorse Racing Game                                      ║');
  console.log('║   Minimal horse racing for prediction markets                ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Server: ${SERVER_URL}`);
  console.log(`🎮 A2A Agent Card: ${SERVER_URL}/.well-known/agent-card.json`);
  console.log(`📊 REST API: ${SERVER_URL}/api/race`);
  console.log(`🏁 Races: Auto-starting every 90 seconds`);
  console.log('');
  
  if (oraclePublisher) {
    console.log(`🔮 Oracle: ${ORACLE_ADDRESS}`);
    console.log(`   Publishing race results on-chain`);
  } else {
    console.log(`⚠️  Oracle not configured (set PREDICTION_ORACLE_ADDRESS)`);
  }
  
  if (marketCreator) {
    console.log(`🏭 MarketFactory: ${MARKET_FACTORY_ADDRESS}`);
    console.log(`   Auto-creating markets on Predimarket`);
  } else {
    console.log(`⚠️  MarketFactory not configured (set MARKET_FACTORY_ADDRESS)`);
  }
  
  if (registryClient?.isEnabled()) {
    console.log(`📝 ERC-8004: Enabled`);
  } else {
    console.log(`⚠️  ERC-8004: Disabled (deploy contracts first)`);
  }
  
  console.log('');
  console.log(`🐴 Horses: Thunder, Lightning, Storm, Blaze`);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  raceEngine.stop();
  if (marketCreator) {
    marketCreator.stop();
  }
  process.exit(0);
});

export { raceEngine, a2aServer, oraclePublisher, marketCreator };

