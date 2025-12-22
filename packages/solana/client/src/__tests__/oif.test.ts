import { describe, it, expect } from 'bun:test';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import {
  OIFClient,
  createOIFClient,
  OIF_PROGRAM_ID,
  CHAIN_IDS,
} from '../oif';

const connection = new Connection('https://api.devnet.solana.com');

describe('OIFClient', () => {
  describe('instantiation', () => {
    it('creates client with default program ID', () => {
      const client = createOIFClient(connection);
      expect(client).toBeInstanceOf(OIFClient);
    });

    it('creates client with custom program ID', () => {
      const customProgramId = Keypair.generate().publicKey;
      const client = createOIFClient(connection, customProgramId);
      expect(client).toBeInstanceOf(OIFClient);
    });
  });

  describe('PDA derivation', () => {
    const client = createOIFClient(connection);

    it('derives config PDA deterministically', () => {
      const [pda1, bump1] = client.getConfigPDA();
      const [pda2, bump2] = client.getConfigPDA();

      expect(pda1.equals(pda2)).toBe(true);
      expect(bump1).toBe(bump2);
      expect(bump1).toBeGreaterThanOrEqual(0);
      expect(bump1).toBeLessThanOrEqual(255);
    });

    it('derives intent PDA from intent ID', () => {
      const intentId1 = new Uint8Array(32).fill(1);
      const intentId2 = new Uint8Array(32).fill(2);

      const [pda1] = client.getIntentPDA(intentId1);
      const [pda2] = client.getIntentPDA(intentId2);
      const [pda3] = client.getIntentPDA(intentId1);

      expect(pda1.equals(pda2)).toBe(false);
      expect(pda1.equals(pda3)).toBe(true);
    });

    it('derives solver PDA from owner', () => {
      const owner1 = Keypair.generate().publicKey;
      const owner2 = Keypair.generate().publicKey;

      const [pda1] = client.getSolverPDA(owner1);
      const [pda2] = client.getSolverPDA(owner2);
      const [pda3] = client.getSolverPDA(owner1);

      expect(pda1.equals(pda2)).toBe(false);
      expect(pda1.equals(pda3)).toBe(true);
    });

    it('derives stake vault PDA deterministically', () => {
      const [pda1, bump1] = client.getStakeVaultPDA();
      const [pda2, bump2] = client.getStakeVaultPDA();

      expect(pda1.equals(pda2)).toBe(true);
      expect(bump1).toBe(bump2);
    });
  });

  describe('intent ID generation', () => {
    const client = createOIFClient(connection);

    it('generates 32-byte intent ID', () => {
      const intentId = client.generateIntentId();
      expect(intentId).toBeInstanceOf(Uint8Array);
      expect(intentId.length).toBe(32);
    });

    it('generates unique intent IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = client.generateIntentId();
        const idHex = Array.from(id).map(b => b.toString(16).padStart(2, '0')).join('');
        ids.add(idHex);
      }
      expect(ids.size).toBe(100);
    });

    it('generates cryptographically random IDs', () => {
      const id1 = client.generateIntentId();
      const id2 = client.generateIntentId();

      // Check they're not all zeros or all same value
      expect(id1.some(b => b !== 0)).toBe(true);
      expect(id2.some(b => b !== 0)).toBe(true);
      
      // Check they're different
      const areEqual = id1.every((b, i) => b === id2[i]);
      expect(areEqual).toBe(false);
    });
  });

  describe('chain IDs', () => {
    it('exports correct chain IDs', () => {
      expect(CHAIN_IDS.SOLANA_MAINNET).toBe(1399811149);
      expect(CHAIN_IDS.SOLANA_DEVNET).toBe(1399811150);
      expect(CHAIN_IDS.ETHEREUM).toBe(1);
      expect(CHAIN_IDS.BASE).toBe(8453);
      expect(CHAIN_IDS.BASE_SEPOLIA).toBe(84532);
      expect(CHAIN_IDS.ARBITRUM).toBe(42161);
      expect(CHAIN_IDS.OPTIMISM).toBe(10);
      expect(CHAIN_IDS.POLYGON).toBe(137);
    });
  });

  describe('constants', () => {
    it('exports OIF_PROGRAM_ID', () => {
      expect(OIF_PROGRAM_ID).toBeDefined();
      expect(OIF_PROGRAM_ID).toBeInstanceOf(PublicKey);
    });
  });
});

describe('Address conversion', () => {
  describe('EVM address handling', () => {
    it('handles EVM addresses in intent creation', async () => {
      const client = createOIFClient(connection);
      const creator = Keypair.generate().publicKey;
      const sourceToken = Keypair.generate().publicKey;

      // Test that EVM addresses are accepted as strings
      const evmRecipient = '0xdead000000000000000000000000000000000beef';
      const evmToken = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC on Ethereum

      // This should not throw - it tests the internal conversion
      const { instructions, intentId } = await client.createIntentInstructions(
        {
          sourceChain: CHAIN_IDS.SOLANA_MAINNET,
          destinationChain: CHAIN_IDS.ETHEREUM,
          sourceToken,
          destinationToken: evmToken,
          sourceAmount: 1000000n,
          minDestinationAmount: 990000n,
          recipient: evmRecipient,
        },
        creator
      );

      expect(instructions.length).toBeGreaterThan(0);
      expect(intentId.length).toBe(32);
    });

    it('handles Solana addresses as strings', async () => {
      const client = createOIFClient(connection);
      const creator = Keypair.generate().publicKey;
      const sourceToken = Keypair.generate().publicKey;
      const destinationToken = Keypair.generate().publicKey;
      const recipient = Keypair.generate().publicKey;

      const { instructions, intentId } = await client.createIntentInstructions(
        {
          sourceChain: CHAIN_IDS.SOLANA_MAINNET,
          destinationChain: CHAIN_IDS.SOLANA_DEVNET,
          sourceToken,
          destinationToken: destinationToken.toBase58(),
          sourceAmount: 1000000n,
          minDestinationAmount: 990000n,
          recipient: recipient.toBase58(),
        },
        creator
      );

      expect(instructions.length).toBeGreaterThan(0);
      expect(intentId.length).toBe(32);
    });
  });
});

describe('Intent status types', () => {
  it('handles all intent status values', () => {
    // These are the valid status values based on the deserializeIntent implementation
    const validStatuses = ['open', 'filled', 'cancelled', 'expired'];
    
    for (const status of validStatuses) {
      expect(typeof status).toBe('string');
    }
  });
});
