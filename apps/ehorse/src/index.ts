/**
 * eHorse Racing Game Server
 * Minimal horse racing game for prediction markets
 */

import express from 'express';
import cors from 'cors';
import { RaceEngine } from './game.js';
import { A2AServer } from './a2a.js';
import { ContestPublisher } from './oracle.js';
import { RegistryClient } from './registry.js';
import { MarketCreator } from './market-creator.js';

const PORT = parseInt(process.env.EHORSE_PORT || '5700');
const SERVER_URL = process.env.EHORSE_SERVER_URL || `http://localhost:${PORT}`;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.EHORSE_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
const CONTEST_ADDRESS = process.env.CONTEST_ADDRESS || process.env.EHORSE_GAME_ADDRESS || '';
const MARKET_FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS || '';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize components
const raceEngine = new RaceEngine();
const a2aServer = new A2AServer(raceEngine, SERVER_URL);

let contestPublisher: ContestPublisher | null = null;
let registryClient: RegistryClient | null = null as RegistryClient | null;
let marketCreator: MarketCreator | null = null;

// Optional: Contest.sol integration (TEE oracle)
if (CONTEST_ADDRESS && PRIVATE_KEY) {
  contestPublisher = new ContestPublisher({
    rpcUrl: RPC_URL,
    contestAddress: CONTEST_ADDRESS,
    privateKey: PRIVATE_KEY
  });
  console.log('✅ Contest publisher enabled (TEE mode)');

  // Set up race callbacks for TEE contest flow
  raceEngine.setRaceCallbacks({
    // 1. Announce contest when race created (PENDING)
    onAnnounce: async (raceId: string, predeterminedWinner: number) => {
      try {
        await contestPublisher!.announceRace(raceId, predeterminedWinner);
        // Success logged in announceRace already
      } catch (err: any) {
        console.error(`❌ Failed to announce contest for race ${raceId}:`, err.message);
        // Rethrow to let game.ts handle cancellation
        throw err;
      }
    },
    // 2. Start contest when race starts (ACTIVE - trading begins)
    onStart: async (raceId: string) => {
      try {
        await contestPublisher!.startRace(raceId);
      } catch (err: any) {
        console.error(`❌ Failed to start contest for race ${raceId}:`, err.message);
      }
    },
    // 3. Start grace period after race (GRACE_PERIOD - trading frozen)
    onGracePeriod: async (raceId: string) => {
      try {
        await contestPublisher!.startGracePeriod(raceId);
      } catch (err: any) {
        console.error(`❌ Failed to start grace period for race ${raceId}:`, err.message);
      }
    },
    // 4. Publish results with TEE attestation (FINISHED)
    onFinish: async (raceId: string, winner: number) => {
      try {
        await contestPublisher!.revealRace(raceId, winner);
      } catch (err: any) {
        console.error(`❌ Failed to publish results for race ${raceId}:`, err.message);
      }
    }
  });
}

// Optional: ERC-8004 registration
const IDENTITY_REGISTRY_ADDRESS = process.env.IDENTITY_REGISTRY_ADDRESS || '';
if (IDENTITY_REGISTRY_ADDRESS && PRIVATE_KEY) {
  registryClient = new RegistryClient(RPC_URL, PRIVATE_KEY, IDENTITY_REGISTRY_ADDRESS);
  registryClient.initialize().then(() => {
    if (registryClient?.isEnabled()) {
      registryClient.registerGame('ehorse', SERVER_URL).then(() => {
        console.log('✅ Registered to ERC-8004 registry');
      }).catch(err => {
        console.error('⚠️  Registry registration failed:', err.message);
      });
    }
  }).catch(err => {
    console.error('⚠️  Registry client failed to initialize:', err.message);
  });
}

// Optional: Market creator (auto-creates markets on Predimarket)
if (MARKET_FACTORY_ADDRESS && CONTEST_ADDRESS && PRIVATE_KEY) {
  marketCreator = new MarketCreator({
    rpcUrl: RPC_URL,
    marketFactoryAddress: MARKET_FACTORY_ADDRESS,
    oracleAddress: CONTEST_ADDRESS, // Contest.sol implements IPredictionOracle
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
    service: 'ehorse-tee',
    mode: 'tee',
    race: raceEngine.getCurrentRace()?.id,
    contest: contestPublisher?.isEnabled() || false,
    registry: registryClient?.isEnabled() || false,
    marketCreator: marketCreator !== null,
    containerHash: contestPublisher?.getContainerHash()
  });
});

// Oracle publishing is now handled via race callbacks

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🐴 eHorse Racing Game (TEE Mode)                          ║');
  console.log('║   Off-chain game in TEE → On-chain oracle                    ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Server: ${SERVER_URL}`);
  console.log(`🎮 A2A Agent Card: ${SERVER_URL}/.well-known/agent-card.json`);
  console.log(`📊 REST API: ${SERVER_URL}/api/race`);
  console.log(`🏁 Mode: TEE (game runs off-chain, results on-chain)`);
  console.log('');
  
  if (contestPublisher) {
    console.log(`🔒 Contest Oracle: ${CONTEST_ADDRESS}`);
    console.log(`   Publishing with TEE attestation`);
    console.log(`   Container: ${contestPublisher.getContainerHash().slice(0, 20)}...`);
    console.log(`   Flow: PENDING → ACTIVE (60s) → GRACE (30s) → FINISHED`);
  } else {
    console.log(`⚠️  Contest not configured (set CONTEST_ADDRESS)`);
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
  console.log(`⚡ Game logic runs in TEE (off-chain)`);
  console.log(`📜 Results published on-chain with attestation`);
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

export { raceEngine, a2aServer, contestPublisher, marketCreator };

