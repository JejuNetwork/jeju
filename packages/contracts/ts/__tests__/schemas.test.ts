/**
 * Zod Schema Validation Tests
 * 
 * Tests for deployment schemas and parsing functions.
 */

import { describe, test, expect } from 'bun:test';
import {
  AddressSchema,
  OptionalAddressSchema,
  UniswapV4DeploymentSchema,
  BazaarMarketplaceDeploymentSchema,
  ERC20FactoryDeploymentSchema,
  IdentitySystemDeploymentSchema,
  PaymasterSystemDeploymentSchema,
  XLPDeploymentSchema,
  GameSystemDeploymentSchema,
  LaunchpadDeploymentSchema,
  ContractAddressesSchema,
  parseUniswapV4Deployment,
  parseBazaarMarketplaceDeployment,
  parseERC20FactoryDeployment,
  parseIdentitySystemDeployment,
  parsePaymasterSystemDeployment,
  parseXLPDeployment,
  parseGameSystemDeployment,
  parseLaunchpadDeployment,
  safeParseUniswapV4Deployment,
  safeParseGameSystemDeployment,
} from '../schemas';
import { ZodError } from 'zod';

// Valid test addresses
const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_ADDRESS_2 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('schemas.ts - Zod Schema Validation', () => {
  describe('AddressSchema', () => {
    test('accepts valid checksummed address', () => {
      expect(() => AddressSchema.parse(VALID_ADDRESS)).not.toThrow();
    });

    test('accepts valid lowercase address', () => {
      expect(() => AddressSchema.parse(VALID_ADDRESS.toLowerCase())).not.toThrow();
    });

    test('accepts valid uppercase address', () => {
      expect(() => AddressSchema.parse(VALID_ADDRESS.toUpperCase().replace('0X', '0x'))).not.toThrow();
    });

    test('rejects address without 0x prefix', () => {
      expect(() => AddressSchema.parse(VALID_ADDRESS.slice(2))).toThrow();
    });

    test('rejects address that is too short', () => {
      expect(() => AddressSchema.parse('0x1234')).toThrow();
    });

    test('rejects address that is too long', () => {
      expect(() => AddressSchema.parse(VALID_ADDRESS + '00')).toThrow();
    });

    test('rejects non-hex characters', () => {
      expect(() => AddressSchema.parse('0xgggggggggggggggggggggggggggggggggggggggg')).toThrow();
    });

    test('rejects empty string', () => {
      expect(() => AddressSchema.parse('')).toThrow();
    });

    test('rejects non-string values', () => {
      expect(() => AddressSchema.parse(123)).toThrow();
      expect(() => AddressSchema.parse(null)).toThrow();
      expect(() => AddressSchema.parse({})).toThrow();
    });
  });

  describe('OptionalAddressSchema', () => {
    test('accepts valid address', () => {
      expect(OptionalAddressSchema.parse(VALID_ADDRESS)).toBe(VALID_ADDRESS);
    });

    test('accepts undefined', () => {
      expect(OptionalAddressSchema.parse(undefined)).toBeUndefined();
    });

    test('accepts null', () => {
      expect(OptionalAddressSchema.parse(null)).toBeNull();
    });

    test('rejects invalid address', () => {
      expect(() => OptionalAddressSchema.parse('invalid')).toThrow();
    });
  });

  describe('UniswapV4DeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        poolManager: VALID_ADDRESS,
        weth: VALID_ADDRESS_2,
        swapRouter: VALID_ADDRESS,
        positionManager: VALID_ADDRESS_2,
        quoterV4: VALID_ADDRESS,
        stateView: VALID_ADDRESS_2,
        chainId: 1337,
        network: 'localnet',
      };

      const result = UniswapV4DeploymentSchema.parse(data);
      expect(result.poolManager).toBe(VALID_ADDRESS);
      expect(result.chainId).toBe(1337);
    });

    test('allows optional fields to be missing', () => {
      const data = {
        poolManager: VALID_ADDRESS,
      };

      const result = UniswapV4DeploymentSchema.parse(data);
      expect(result.poolManager).toBe(VALID_ADDRESS);
      expect(result.weth).toBeUndefined();
    });

    test('parses features object', () => {
      const data = {
        features: {
          singleton: true,
          hooks: true,
          flashAccounting: false,
          nativeETH: true,
        },
      };

      const result = UniswapV4DeploymentSchema.parse(data);
      expect(result.features?.singleton).toBe(true);
    });

    test('accepts empty object', () => {
      expect(() => UniswapV4DeploymentSchema.parse({})).not.toThrow();
    });
  });

  describe('BazaarMarketplaceDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        at: VALID_ADDRESS,
        marketplace: VALID_ADDRESS_2,
        goldToken: VALID_ADDRESS,
        usdcToken: VALID_ADDRESS_2,
        Owner: VALID_ADDRESS,
        Recipient: VALID_ADDRESS_2,
      };

      const result = BazaarMarketplaceDeploymentSchema.parse(data);
      expect(result.marketplace).toBe(VALID_ADDRESS_2);
    });

    test('allows all fields to be optional', () => {
      expect(() => BazaarMarketplaceDeploymentSchema.parse({})).not.toThrow();
    });
  });

  describe('ERC20FactoryDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        at: VALID_ADDRESS,
        factory: VALID_ADDRESS_2,
      };

      const result = ERC20FactoryDeploymentSchema.parse(data);
      expect(result.factory).toBe(VALID_ADDRESS_2);
    });
  });

  describe('IdentitySystemDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        Deployer: VALID_ADDRESS,
        IdentityRegistry: VALID_ADDRESS_2,
        identityRegistry: VALID_ADDRESS,
        reputationRegistry: VALID_ADDRESS_2,
        validationRegistry: VALID_ADDRESS,
        serviceRegistry: VALID_ADDRESS_2,
        creditManager: VALID_ADDRESS,
        usdc: VALID_ADDRESS_2,
        elizaOS: VALID_ADDRESS,
      };

      const result = IdentitySystemDeploymentSchema.parse(data);
      expect(result.IdentityRegistry).toBe(VALID_ADDRESS_2);
    });
  });

  describe('PaymasterSystemDeploymentSchema', () => {
    test('parses valid deployment with example deployments', () => {
      const data = {
        tokenRegistry: VALID_ADDRESS,
        priceOracle: VALID_ADDRESS_2,
        paymasterFactory: VALID_ADDRESS,
        entryPoint: VALID_ADDRESS_2,
        sponsoredPaymaster: VALID_ADDRESS,
        exampleDeployments: [
          {
            token: VALID_ADDRESS,
            symbol: 'USDC',
            paymaster: VALID_ADDRESS,
            vault: VALID_ADDRESS_2,
            distributor: VALID_ADDRESS,
          },
        ],
      };

      const result = PaymasterSystemDeploymentSchema.parse(data);
      expect(result.exampleDeployments?.[0]?.symbol).toBe('USDC');
    });

    test('validates example deployments array', () => {
      const data = {
        exampleDeployments: [
          {
            token: 'invalid',
            symbol: 'USDC',
            paymaster: VALID_ADDRESS,
            vault: VALID_ADDRESS_2,
            distributor: VALID_ADDRESS,
          },
        ],
      };

      expect(() => PaymasterSystemDeploymentSchema.parse(data)).toThrow();
    });
  });

  describe('XLPDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        v2Factory: VALID_ADDRESS,
        v3Factory: VALID_ADDRESS_2,
        router: VALID_ADDRESS,
        positionManager: VALID_ADDRESS_2,
        liquidityAggregator: VALID_ADDRESS,
        routerRegistry: VALID_ADDRESS_2,
        weth: VALID_ADDRESS,
        deployedAt: '2024-01-01',
        chainId: 1337,
      };

      const result = XLPDeploymentSchema.parse(data);
      expect(result.v2Factory).toBe(VALID_ADDRESS);
      expect(result.chainId).toBe(1337);
    });
  });

  describe('GameSystemDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        goldToken: VALID_ADDRESS,
        itemsNFT: VALID_ADDRESS_2,
        gameIntegration: VALID_ADDRESS,
        playerTradeEscrow: VALID_ADDRESS_2,
        gameAgentId: 'agent-123',
        gameSigner: VALID_ADDRESS,
        mudWorld: VALID_ADDRESS_2,
        jejuIntegrationSystem: VALID_ADDRESS,
        appId: 'app-123',
        gameName: 'Test Game',
        baseURI: 'https://example.com/metadata/',
        deployedAt: '2024-01-01',
        chainId: 1337,
      };

      const result = GameSystemDeploymentSchema.parse(data);
      expect(result.gameName).toBe('Test Game');
    });

    test('allows null values for nullable fields', () => {
      const data = {
        goldToken: null,
        itemsNFT: null,
        gameAgentId: null,
      };

      const result = GameSystemDeploymentSchema.parse(data);
      expect(result.goldToken).toBeNull();
    });
  });

  describe('LaunchpadDeploymentSchema', () => {
    test('parses valid deployment', () => {
      const data = {
        tokenLaunchpad: VALID_ADDRESS,
        lpLockerTemplate: VALID_ADDRESS_2,
        defaultCommunityVault: VALID_ADDRESS,
        xlpV2Factory: VALID_ADDRESS_2,
        weth: VALID_ADDRESS,
        deployedAt: '2024-01-01',
        chainId: 1337,
      };

      const result = LaunchpadDeploymentSchema.parse(data);
      expect(result.tokenLaunchpad).toBe(VALID_ADDRESS);
    });
  });

  describe('ContractAddressesSchema', () => {
    test('parses complete contract addresses', () => {
      const data = {
        identityRegistry: VALID_ADDRESS,
        reputationRegistry: VALID_ADDRESS_2,
        validationRegistry: VALID_ADDRESS,
        serviceRegistry: VALID_ADDRESS_2,
        banManager: VALID_ADDRESS,
        poolManager: VALID_ADDRESS_2,
        marketplace: VALID_ADDRESS,
        erc20Factory: VALID_ADDRESS_2,
        usdc: VALID_ADDRESS,
        elizaOS: VALID_ADDRESS_2,
        tokenLaunchpad: VALID_ADDRESS,
      };

      const result = ContractAddressesSchema.parse(data);
      expect(result.identityRegistry).toBe(VALID_ADDRESS);
    });

    test('allows partial addresses', () => {
      const data = {
        identityRegistry: VALID_ADDRESS,
      };

      const result = ContractAddressesSchema.parse(data);
      expect(result.identityRegistry).toBe(VALID_ADDRESS);
      expect(result.reputationRegistry).toBeUndefined();
    });
  });

  describe('Parse functions', () => {
    describe('parseUniswapV4Deployment', () => {
      test('parses valid data', () => {
        const data = { poolManager: VALID_ADDRESS };
        const result = parseUniswapV4Deployment(data);
        expect(result.poolManager).toBe(VALID_ADDRESS);
      });

      test('throws ZodError on invalid data', () => {
        expect(() => parseUniswapV4Deployment({ poolManager: 'invalid' })).toThrow(ZodError);
      });
    });

    describe('parseBazaarMarketplaceDeployment', () => {
      test('parses valid data', () => {
        const data = { marketplace: VALID_ADDRESS };
        const result = parseBazaarMarketplaceDeployment(data);
        expect(result.marketplace).toBe(VALID_ADDRESS);
      });
    });

    describe('parseERC20FactoryDeployment', () => {
      test('parses valid data', () => {
        const data = { factory: VALID_ADDRESS };
        const result = parseERC20FactoryDeployment(data);
        expect(result.factory).toBe(VALID_ADDRESS);
      });
    });

    describe('parseIdentitySystemDeployment', () => {
      test('parses valid data', () => {
        const data = { identityRegistry: VALID_ADDRESS };
        const result = parseIdentitySystemDeployment(data);
        expect(result.identityRegistry).toBe(VALID_ADDRESS);
      });
    });

    describe('parsePaymasterSystemDeployment', () => {
      test('parses valid data', () => {
        const data = { sponsoredPaymaster: VALID_ADDRESS };
        const result = parsePaymasterSystemDeployment(data);
        expect(result.sponsoredPaymaster).toBe(VALID_ADDRESS);
      });
    });

    describe('parseXLPDeployment', () => {
      test('parses valid data', () => {
        const data = { router: VALID_ADDRESS };
        const result = parseXLPDeployment(data);
        expect(result.router).toBe(VALID_ADDRESS);
      });
    });

    describe('parseGameSystemDeployment', () => {
      test('parses valid data', () => {
        const data = { goldToken: VALID_ADDRESS };
        const result = parseGameSystemDeployment(data);
        expect(result.goldToken).toBe(VALID_ADDRESS);
      });
    });

    describe('parseLaunchpadDeployment', () => {
      test('parses valid data', () => {
        const data = { tokenLaunchpad: VALID_ADDRESS };
        const result = parseLaunchpadDeployment(data);
        expect(result.tokenLaunchpad).toBe(VALID_ADDRESS);
      });
    });
  });

  describe('Safe parse functions', () => {
    describe('safeParseUniswapV4Deployment', () => {
      test('returns data on valid input', () => {
        const data = { poolManager: VALID_ADDRESS };
        const result = safeParseUniswapV4Deployment(data);
        expect(result).toBeDefined();
        expect(result?.poolManager).toBe(VALID_ADDRESS);
      });

      test('returns undefined on invalid input', () => {
        const result = safeParseUniswapV4Deployment({ poolManager: 'invalid' });
        expect(result).toBeUndefined();
      });

      test('returns undefined on null input', () => {
        const result = safeParseUniswapV4Deployment(null);
        expect(result).toBeUndefined();
      });
    });

    describe('safeParseGameSystemDeployment', () => {
      test('returns data on valid input', () => {
        const data = { goldToken: VALID_ADDRESS };
        const result = safeParseGameSystemDeployment(data);
        expect(result).toBeDefined();
        expect(result?.goldToken).toBe(VALID_ADDRESS);
      });

      test('returns undefined on invalid input', () => {
        const result = safeParseGameSystemDeployment({ goldToken: 'invalid' });
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Property-based tests', () => {
    function randomValidAddress(): string {
      const chars = '0123456789abcdef';
      let addr = '0x';
      for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)];
      }
      return addr;
    }

    test('AddressSchema accepts all valid format addresses', () => {
      for (let i = 0; i < 100; i++) {
        const addr = randomValidAddress();
        expect(() => AddressSchema.parse(addr)).not.toThrow();
      }
    });

    test('Schemas are lenient with optional fields', () => {
      // All schemas should accept empty objects or objects with only optional fields
      expect(() => UniswapV4DeploymentSchema.parse({})).not.toThrow();
      expect(() => BazaarMarketplaceDeploymentSchema.parse({})).not.toThrow();
      expect(() => ERC20FactoryDeploymentSchema.parse({})).not.toThrow();
      expect(() => IdentitySystemDeploymentSchema.parse({})).not.toThrow();
      expect(() => PaymasterSystemDeploymentSchema.parse({})).not.toThrow();
      expect(() => XLPDeploymentSchema.parse({})).not.toThrow();
      expect(() => GameSystemDeploymentSchema.parse({})).not.toThrow();
      expect(() => LaunchpadDeploymentSchema.parse({})).not.toThrow();
      expect(() => ContractAddressesSchema.parse({})).not.toThrow();
    });
  });
});
