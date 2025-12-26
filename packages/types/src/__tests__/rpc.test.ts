import { describe, expect, it } from 'bun:test'
import {
  JsonValueSchema,
  EvmChainIdSchema,
  SolanaNetworkIdSchema,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcResponseSchema,
  ChainIdResponseSchema,
  BlockNumberResponseSchema,
  GetCodeResponseSchema,
  GetBalanceResponseSchema,
  RATE_LIMITS,
  parseChainIdResponse,
  parseBlockNumberResponse,
  parseGetCodeResponse,
  parseGetBalanceResponse,
} from '../rpc'

describe('RPC Types', () => {
  describe('JsonValueSchema', () => {
    it('validates primitives', () => {
      expect(JsonValueSchema.parse('string')).toBe('string')
      expect(JsonValueSchema.parse(123)).toBe(123)
      expect(JsonValueSchema.parse(true)).toBe(true)
      expect(JsonValueSchema.parse(null)).toBe(null)
    })

    it('validates arrays', () => {
      expect(JsonValueSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
      expect(JsonValueSchema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
      expect(JsonValueSchema.parse([1, 'mixed', true])).toEqual([1, 'mixed', true])
    })

    it('validates objects', () => {
      expect(JsonValueSchema.parse({ key: 'value' })).toEqual({ key: 'value' })
      expect(JsonValueSchema.parse({ nested: { key: 1 } })).toEqual({ nested: { key: 1 } })
    })

    it('validates nested structures', () => {
      const complex = {
        name: 'test',
        values: [1, 2, { nested: true }],
        config: { enabled: false, options: ['a', 'b'] },
      }
      expect(JsonValueSchema.parse(complex)).toEqual(complex)
    })
  })

  describe('EvmChainIdSchema', () => {
    it('validates known chain IDs', () => {
      expect(EvmChainIdSchema.parse(1)).toBe(1) // Mainnet
      expect(EvmChainIdSchema.parse(10)).toBe(10) // Optimism
      expect(EvmChainIdSchema.parse(56)).toBe(56) // BSC
      expect(EvmChainIdSchema.parse(137)).toBe(137) // Polygon
      expect(EvmChainIdSchema.parse(42161)).toBe(42161) // Arbitrum
      expect(EvmChainIdSchema.parse(43114)).toBe(43114) // Avalanche
      expect(EvmChainIdSchema.parse(8453)).toBe(8453) // Base
    })

    it('validates testnet chain IDs', () => {
      expect(EvmChainIdSchema.parse(84532)).toBe(84532) // Base Sepolia
      expect(EvmChainIdSchema.parse(11155111)).toBe(11155111) // Sepolia
      expect(EvmChainIdSchema.parse(11155420)).toBe(11155420) // OP Sepolia
      expect(EvmChainIdSchema.parse(421614)).toBe(421614) // Arb Sepolia
    })

    it('validates Jeju chain IDs', () => {
      expect(EvmChainIdSchema.parse(420690)).toBe(420690)
      expect(EvmChainIdSchema.parse(420691)).toBe(420691)
    })

    it('validates local chain ID', () => {
      expect(EvmChainIdSchema.parse(31337)).toBe(31337) // Hardhat/Anvil
    })

    it('rejects unknown chain IDs', () => {
      expect(() => EvmChainIdSchema.parse(999)).toThrow()
      expect(() => EvmChainIdSchema.parse(0)).toThrow()
    })
  })

  describe('SolanaNetworkIdSchema', () => {
    it('validates Solana network IDs', () => {
      expect(SolanaNetworkIdSchema.parse(101)).toBe(101) // Mainnet
      expect(SolanaNetworkIdSchema.parse(103)).toBe(103) // Devnet
    })

    it('rejects invalid network IDs', () => {
      expect(() => SolanaNetworkIdSchema.parse(102)).toThrow()
      expect(() => SolanaNetworkIdSchema.parse(0)).toThrow()
    })
  })

  describe('JsonRpcRequestSchema', () => {
    it('validates valid request', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }
      expect(() => JsonRpcRequestSchema.parse(request)).not.toThrow()
    })

    it('validates request with params', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: '0x1234', data: '0xabcd' }, 'latest'],
        id: 'request-1',
      }
      expect(() => JsonRpcRequestSchema.parse(request)).not.toThrow()
    })

    it('defaults params to empty array', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'eth_chainId',
        id: 1,
      }
      const parsed = JsonRpcRequestSchema.parse(request)
      expect(parsed.params).toEqual([])
    })

    it('allows string or number id', () => {
      expect(() =>
        JsonRpcRequestSchema.parse({
          jsonrpc: '2.0',
          method: 'test',
          id: 123,
        })
      ).not.toThrow()

      expect(() =>
        JsonRpcRequestSchema.parse({
          jsonrpc: '2.0',
          method: 'test',
          id: 'string-id',
        })
      ).not.toThrow()
    })
  })

  describe('JsonRpcSuccessResponseSchema', () => {
    it('validates success response', () => {
      const response = {
        jsonrpc: '2.0',
        result: '0x1',
        id: 1,
      }
      expect(() => JsonRpcSuccessResponseSchema.parse(response)).not.toThrow()
    })

    it('validates response with complex result', () => {
      const response = {
        jsonrpc: '2.0',
        result: {
          blockNumber: '0x123',
          transactions: [],
        },
        id: 'test',
      }
      expect(() => JsonRpcSuccessResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('JsonRpcErrorResponseSchema', () => {
    it('validates error response', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid request',
        },
        id: null,
      }
      expect(() => JsonRpcErrorResponseSchema.parse(response)).not.toThrow()
    })

    it('validates error with data', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: { details: 'missing required field' },
        },
        id: 1,
      }
      expect(() => JsonRpcErrorResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('JsonRpcResponseSchema', () => {
    it('validates success response', () => {
      const response = {
        jsonrpc: '2.0',
        result: 'data',
        id: 1,
      }
      expect(() => JsonRpcResponseSchema.parse(response)).not.toThrow()
    })

    it('validates error response', () => {
      const response = {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Error' },
        id: 1,
      }
      expect(() => JsonRpcResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('ChainIdResponseSchema', () => {
    it('validates chain ID response', () => {
      const response = {
        jsonrpc: '2.0',
        result: '0x1',
        id: 1,
      }
      expect(() => ChainIdResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('BlockNumberResponseSchema', () => {
    it('validates block number response', () => {
      const response = {
        jsonrpc: '2.0',
        result: '0xbc614e',
        id: 1,
      }
      expect(() => BlockNumberResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('GetCodeResponseSchema', () => {
    it('validates get code response', () => {
      const response = {
        jsonrpc: '2.0',
        result: '0x608060405234801561001057600080fd5b50',
        id: 1,
      }
      expect(() => GetCodeResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('GetBalanceResponseSchema', () => {
    it('validates get balance response', () => {
      const response = {
        jsonrpc: '2.0',
        result: '0xde0b6b3a7640000',
        id: 1,
      }
      expect(() => GetBalanceResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('RATE_LIMITS', () => {
    it('has expected tiers', () => {
      expect(RATE_LIMITS.FREE).toBe(10)
      expect(RATE_LIMITS.BASIC).toBe(100)
      expect(RATE_LIMITS.PRO).toBe(1000)
      expect(RATE_LIMITS.UNLIMITED).toBe(0)
    })
  })

  describe('Parse Functions', () => {
    describe('parseChainIdResponse', () => {
      it('parses chain ID correctly', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0x1',
          id: 1,
        }
        expect(parseChainIdResponse(response)).toBe(1)
      })

      it('parses larger chain IDs', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0xa',
          id: 1,
        }
        expect(parseChainIdResponse(response)).toBe(10)
      })
    })

    describe('parseBlockNumberResponse', () => {
      it('parses block number correctly', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0xbc614e',
          id: 1,
        }
        expect(parseBlockNumberResponse(response)).toBe(12345678)
      })
    })

    describe('parseGetCodeResponse', () => {
      it('parses code correctly', () => {
        const code = '0x608060405234801561001057600080fd5b50'
        const response = {
          jsonrpc: '2.0',
          result: code,
          id: 1,
        }
        expect(parseGetCodeResponse(response)).toBe(code)
      })

      it('returns empty code for no contract', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0x',
          id: 1,
        }
        expect(parseGetCodeResponse(response)).toBe('0x')
      })
    })

    describe('parseGetBalanceResponse', () => {
      it('parses balance correctly', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0xde0b6b3a7640000',
          id: 1,
        }
        expect(parseGetBalanceResponse(response)).toBe(1000000000000000000n)
      })

      it('parses zero balance', () => {
        const response = {
          jsonrpc: '2.0',
          result: '0x0',
          id: 1,
        }
        expect(parseGetBalanceResponse(response)).toBe(0n)
      })
    })
  })
})

