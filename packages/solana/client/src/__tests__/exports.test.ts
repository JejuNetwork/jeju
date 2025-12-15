import { describe, it, expect } from 'bun:test';
import { Connection } from '@solana/web3.js';

// Test that all exports are available from the barrel import
import * as Solana from '../index';

// Use a real connection for testing (can be any valid RPC endpoint)
const connection = new Connection('https://api.devnet.solana.com');

describe('@jeju/solana exports', () => {
  describe('OIF exports', () => {
    it('exports OIFClient class', () => {
      expect(Solana.OIFClient).toBeDefined();
      expect(typeof Solana.OIFClient).toBe('function');
    });

    it('exports createOIFClient factory', () => {
      expect(Solana.createOIFClient).toBeDefined();
      expect(typeof Solana.createOIFClient).toBe('function');
    });

    it('exports OIF_PROGRAM_ID', () => {
      expect(Solana.OIF_PROGRAM_ID).toBeDefined();
    });

    it('exports CHAIN_IDS', () => {
      expect(Solana.CHAIN_IDS).toBeDefined();
      expect(Solana.CHAIN_IDS.SOLANA_MAINNET).toBe(1399811149);
      expect(Solana.CHAIN_IDS.BASE).toBe(8453);
    });
  });

  describe('Launchpad exports', () => {
    it('exports LaunchpadClient class', () => {
      expect(Solana.LaunchpadClient).toBeDefined();
      expect(typeof Solana.LaunchpadClient).toBe('function');
    });

    it('exports createLaunchpadClient factory', () => {
      expect(Solana.createLaunchpadClient).toBeDefined();
      expect(typeof Solana.createLaunchpadClient).toBe('function');
    });

    it('exports LAUNCHPAD_PROGRAM_ID', () => {
      expect(Solana.LAUNCHPAD_PROGRAM_ID).toBeDefined();
    });
  });

  describe('DEX Aggregator exports', () => {
    it('exports SolanaDexAggregator class', () => {
      expect(Solana.SolanaDexAggregator).toBeDefined();
      expect(typeof Solana.SolanaDexAggregator).toBe('function');
    });

    it('exports createSolanaDexAggregator factory', () => {
      expect(Solana.createSolanaDexAggregator).toBeDefined();
      expect(typeof Solana.createSolanaDexAggregator).toBe('function');
    });
  });

  describe('DEX Adapter exports', () => {
    it('exports JupiterAdapter', () => {
      expect(Solana.JupiterAdapter).toBeDefined();
      expect(Solana.createJupiterAdapter).toBeDefined();
    });

    it('exports RaydiumAdapter', () => {
      expect(Solana.RaydiumAdapter).toBeDefined();
      expect(Solana.createRaydiumAdapter).toBeDefined();
    });

    it('exports MeteoraAdapter', () => {
      expect(Solana.MeteoraAdapter).toBeDefined();
      expect(Solana.createMeteoraAdapter).toBeDefined();
    });

    it('exports OrcaAdapter', () => {
      expect(Solana.OrcaAdapter).toBeDefined();
      expect(Solana.createOrcaAdapter).toBeDefined();
    });

    it('exports PumpSwapAdapter', () => {
      expect(Solana.PumpSwapAdapter).toBeDefined();
      expect(Solana.createPumpSwapAdapter).toBeDefined();
    });
  });

  describe('DEX Types exports', () => {
    it('exports WSOL_MINT constant', () => {
      expect(Solana.WSOL_MINT).toBe('So11111111111111111111111111111111111111112');
    });

    it('exports USDC_MINT constant', () => {
      expect(Solana.USDC_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('exports LAMPORTS_PER_SOL constant', () => {
      expect(Solana.LAMPORTS_PER_SOL).toBe(1_000_000_000n);
    });
  });
});

describe('OIFClient functionality', () => {
  it('can instantiate OIFClient with connection', () => {
    const client = Solana.createOIFClient(connection);
    expect(client).toBeInstanceOf(Solana.OIFClient);
  });

  it('generates valid intent ID', () => {
    const client = Solana.createOIFClient(connection);
    const intentId = client.generateIntentId();
    expect(intentId).toBeInstanceOf(Uint8Array);
    expect(intentId.length).toBe(32);
  });

  it('derives PDAs correctly', () => {
    const client = Solana.createOIFClient(connection);
    
    const [configPDA, configBump] = client.getConfigPDA();
    expect(configPDA).toBeDefined();
    expect(typeof configBump).toBe('number');
  });
});

describe('LaunchpadClient functionality', () => {
  it('can instantiate LaunchpadClient with connection', () => {
    const client = Solana.createLaunchpadClient(connection);
    expect(client).toBeInstanceOf(Solana.LaunchpadClient);
  });

  it('calculates buy amount correctly', () => {
    const client = Solana.createLaunchpadClient(connection);
    
    const curve: Solana.BondingCurve = {
      creator: Solana.LAUNCHPAD_PROGRAM_ID,
      tokenMint: Solana.LAUNCHPAD_PROGRAM_ID,
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
      realSolReserves: 0n,
      realTokenReserves: 1_000_000_000_000_000n,
      tokensSold: 0n,
      graduationThreshold: 85_000_000_000n,
      creatorFeeBps: 100,
      graduated: false,
      createdAt: 0n,
    };

    const tokensOut = client.calculateBuyAmount(curve, 1_000_000_000n);
    expect(tokensOut).toBeGreaterThan(0n);
  });

  it('calculates current price correctly', () => {
    const client = Solana.createLaunchpadClient(connection);
    
    const curve: Solana.BondingCurve = {
      creator: Solana.LAUNCHPAD_PROGRAM_ID,
      tokenMint: Solana.LAUNCHPAD_PROGRAM_ID,
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
      realSolReserves: 0n,
      realTokenReserves: 1_000_000_000_000_000n,
      tokensSold: 0n,
      graduationThreshold: 85_000_000_000n,
      creatorFeeBps: 100,
      graduated: false,
      createdAt: 0n,
    };

    const price = client.getCurrentPrice(curve);
    expect(price).toBeGreaterThan(0);
  });
});

describe('Type definitions', () => {
  it('TokenInfo type is usable', () => {
    const token: Solana.TokenInfo = {
      mint: Solana.LAUNCHPAD_PROGRAM_ID,
      decimals: 9,
      symbol: 'SOL',
    };
    expect(token.symbol).toBe('SOL');
  });

  it('SwapParams type is usable', () => {
    const params: Solana.SwapParams = {
      inputMint: Solana.LAUNCHPAD_PROGRAM_ID,
      outputMint: Solana.OIF_PROGRAM_ID,
      amount: 1_000_000_000n,
      slippageBps: 50,
      userPublicKey: Solana.LAUNCHPAD_PROGRAM_ID,
    };
    expect(params.slippageBps).toBe(50);
  });

  it('DexType is usable', () => {
    const dex: Solana.DexType = 'jupiter';
    expect(dex).toBe('jupiter');
  });

  it('PoolType is usable', () => {
    const poolType: Solana.PoolType = 'clmm';
    expect(poolType).toBe('clmm');
  });
});
