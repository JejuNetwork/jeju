/**
 * Schema Validation Tests
 *
 * Comprehensive tests for Zod schemas and validation helpers.
 * Focus on edge cases, boundary conditions, and error handling.
 */

import { describe, expect, test } from 'bun:test'
import {
  // Schemas
  AddressSchema,
  AppConfigSchema,
  BlockNumberResponseSchema,
  ChainIdResponseSchema,
  GetCodeResponseSchema,
  HexSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
  LockMetadataSchema,
  NetworkConfigSchema,
  PreflightCheckSchema,
  PrivateKeySchema,
  parseAppManifest,
  parseBlockNumberResponse,
  // Validation helpers
  parseChainIdResponse,
  parseGetCodeResponse,
  parseIpfsAddResponse,
  parseIpfsIdResponse,
  parseLockMetadata,
  TestAccountSchema,
  TxHashSchema,
} from './schemas'

// ============================================================================
// Address Schema Tests
// ============================================================================

describe('AddressSchema - Ethereum Address Validation', () => {
  test('should accept valid checksummed address', () => {
    const result = AddressSchema.safeParse(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    )
    expect(result.success).toBe(true)
    expect(result.data).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  test('should accept valid lowercase address', () => {
    const result = AddressSchema.safeParse(
      '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    )
    expect(result.success).toBe(true)
  })

  test('should reject all-uppercase address (not EIP-55 checksummed)', () => {
    // All-uppercase addresses fail EIP-55 checksum validation
    const result = AddressSchema.safeParse(
      '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266',
    )
    expect(result.success).toBe(false)
  })

  test('should accept zero address', () => {
    const result = AddressSchema.safeParse(
      '0x0000000000000000000000000000000000000000',
    )
    expect(result.success).toBe(true)
  })

  test('should reject address without 0x prefix', () => {
    const result = AddressSchema.safeParse(
      'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    )
    expect(result.success).toBe(false)
  })

  test('should reject short address', () => {
    const result = AddressSchema.safeParse(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226',
    )
    expect(result.success).toBe(false)
  })

  test('should reject long address', () => {
    const result = AddressSchema.safeParse(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb922666',
    )
    expect(result.success).toBe(false)
  })

  test('should reject non-hex characters', () => {
    const result = AddressSchema.safeParse(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226g',
    )
    expect(result.success).toBe(false)
  })

  test('should reject empty string', () => {
    const result = AddressSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  test('should reject just 0x', () => {
    const result = AddressSchema.safeParse('0x')
    expect(result.success).toBe(false)
  })

  test('should reject non-string input', () => {
    const result = AddressSchema.safeParse(12345)
    expect(result.success).toBe(false)
  })

  test('should reject null', () => {
    const result = AddressSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  test('should reject address with spaces', () => {
    const result = AddressSchema.safeParse(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 ',
    )
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Hex Schema Tests
// ============================================================================

describe('HexSchema - Hex String Validation', () => {
  test('should accept valid hex string', () => {
    const result = HexSchema.safeParse('0x1234567890abcdef')
    expect(result.success).toBe(true)
  })

  test('should accept empty hex (0x)', () => {
    const result = HexSchema.safeParse('0x')
    expect(result.success).toBe(true)
  })

  test('should accept hex with only digits', () => {
    const result = HexSchema.safeParse('0x1234567890')
    expect(result.success).toBe(true)
  })

  test('should accept hex with only letters', () => {
    const result = HexSchema.safeParse('0xabcdef')
    expect(result.success).toBe(true)
  })

  test('should accept uppercase hex letters', () => {
    const result = HexSchema.safeParse('0xABCDEF')
    expect(result.success).toBe(true)
  })

  test('should accept mixed case hex', () => {
    const result = HexSchema.safeParse('0xAaBbCcDdEeFf')
    expect(result.success).toBe(true)
  })

  test('should accept very long hex string', () => {
    const longHex = `0x${'a'.repeat(1000)}`
    const result = HexSchema.safeParse(longHex)
    expect(result.success).toBe(true)
  })

  test('should reject without 0x prefix', () => {
    const result = HexSchema.safeParse('1234567890abcdef')
    expect(result.success).toBe(false)
  })

  test('should reject non-hex characters', () => {
    const result = HexSchema.safeParse('0x1234ghij')
    expect(result.success).toBe(false)
  })

  test('should reject spaces in hex', () => {
    const result = HexSchema.safeParse('0x1234 5678')
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Private Key Schema Tests
// ============================================================================

describe('PrivateKeySchema - Private Key Validation', () => {
  test('should accept valid private key', () => {
    const result = PrivateKeySchema.safeParse(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )
    expect(result.success).toBe(true)
  })

  test('should accept private key with all zeros', () => {
    const result = PrivateKeySchema.safeParse(`0x${'0'.repeat(64)}`)
    expect(result.success).toBe(true)
  })

  test("should accept private key with all f's", () => {
    const result = PrivateKeySchema.safeParse(`0x${'f'.repeat(64)}`)
    expect(result.success).toBe(true)
  })

  test('should reject short private key', () => {
    const result = PrivateKeySchema.safeParse(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff8',
    )
    expect(result.success).toBe(false)
  })

  test('should reject long private key', () => {
    const result = PrivateKeySchema.safeParse(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff800',
    )
    expect(result.success).toBe(false)
  })

  test('should reject private key without prefix', () => {
    const result = PrivateKeySchema.safeParse(
      'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Transaction Hash Schema Tests
// ============================================================================

describe('TxHashSchema - Transaction Hash Validation', () => {
  test('should accept valid transaction hash', () => {
    const result = TxHashSchema.safeParse(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    )
    expect(result.success).toBe(true)
  })

  test('should reject short hash', () => {
    const result = TxHashSchema.safeParse(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde',
    )
    expect(result.success).toBe(false)
  })

  test('should reject long hash', () => {
    const result = TxHashSchema.safeParse(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0',
    )
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// JSON-RPC Schema Tests
// ============================================================================

describe('JsonRpcRequestSchema - JSON-RPC Request Validation', () => {
  test('should accept valid request with params', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept request with string id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: ['0x123', 'latest'],
      id: 'request-1',
    })
    expect(result.success).toBe(true)
  })

  test('should default params to empty array', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      id: 1,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.params).toEqual([])
    }
  })

  test('should reject wrong jsonrpc version', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '1.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    })
    expect(result.success).toBe(false)
  })

  test('should reject missing method', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      params: [],
      id: 1,
    })
    expect(result.success).toBe(false)
  })

  test('should reject missing id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('JsonRpcSuccessResponseSchema - Success Response Validation', () => {
  test('should accept valid success response', () => {
    const result = JsonRpcSuccessResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x123',
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept null result', () => {
    const result = JsonRpcSuccessResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: null,
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept object result', () => {
    const result = JsonRpcSuccessResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: { blockNumber: '0x10' },
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept array result', () => {
    const result = JsonRpcSuccessResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: ['0x1', '0x2'],
      id: 'batch-1',
    })
    expect(result.success).toBe(true)
  })
})

describe('JsonRpcErrorResponseSchema - Error Response Validation', () => {
  test('should accept valid error response', () => {
    const result = JsonRpcErrorResponseSchema.safeParse({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept error with data', () => {
    const result = JsonRpcErrorResponseSchema.safeParse({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Execution reverted',
        data: '0x08c379a0...',
      },
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept null id for parse errors', () => {
    const result = JsonRpcErrorResponseSchema.safeParse({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error',
      },
      id: null,
    })
    expect(result.success).toBe(true)
  })

  test('should reject missing error code', () => {
    const result = JsonRpcErrorResponseSchema.safeParse({
      jsonrpc: '2.0',
      error: {
        message: 'Error message',
      },
      id: 1,
    })
    expect(result.success).toBe(false)
  })

  test('should reject missing error message', () => {
    const result = JsonRpcErrorResponseSchema.safeParse({
      jsonrpc: '2.0',
      error: {
        code: -32600,
      },
      id: 1,
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Chain Response Schema Tests
// ============================================================================

describe('ChainIdResponseSchema - Chain ID Response Validation', () => {
  test('should accept valid chain ID response', () => {
    const result = ChainIdResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x539', // 1337
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept chain ID 1', () => {
    const result = ChainIdResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x1',
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should reject non-hex result', () => {
    const result = ChainIdResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '1337',
      id: 1,
    })
    expect(result.success).toBe(false)
  })
})

describe('BlockNumberResponseSchema - Block Number Response Validation', () => {
  test('should accept valid block number response', () => {
    const result = BlockNumberResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x10',
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept zero block', () => {
    const result = BlockNumberResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x0',
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept large block number', () => {
    const result = BlockNumberResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0xffffffffffffffff',
      id: 1,
    })
    expect(result.success).toBe(true)
  })
})

describe('GetCodeResponseSchema - Get Code Response Validation', () => {
  test('should accept valid bytecode response', () => {
    const result = GetCodeResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x6080604052600080ffeeddcc',
      id: 1,
    })
    expect(result.success).toBe(true)
  })

  test('should accept empty bytecode (EOA)', () => {
    const result = GetCodeResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: '0x',
      id: 1,
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Validation Helper Tests
// ============================================================================

describe('parseChainIdResponse - Chain ID Parsing', () => {
  test('should parse chain ID 1337', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0x539',
      id: 1,
    })
    expect(result).toBe(1337)
  })

  test('should parse chain ID 1', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0x1',
      id: 1,
    })
    expect(result).toBe(1)
  })

  test('should parse chain ID from uppercase hex', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0xABC',
      id: 1,
    })
    expect(result).toBe(2748)
  })

  test('should parse large chain ID', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0xFFFFFF',
      id: 1,
    })
    expect(result).toBe(16777215)
  })

  test('should throw on invalid response', () => {
    expect(() => parseChainIdResponse({ invalid: 'data' })).toThrow()
  })

  test('should throw on non-hex result', () => {
    expect(() =>
      parseChainIdResponse({
        jsonrpc: '2.0',
        result: 'not-hex',
        id: 1,
      }),
    ).toThrow()
  })

  test('should throw on null input', () => {
    expect(() => parseChainIdResponse(null)).toThrow()
  })

  test('should throw on undefined input', () => {
    expect(() => parseChainIdResponse(undefined)).toThrow()
  })
})

describe('parseBlockNumberResponse - Block Number Parsing', () => {
  test('should parse block number 0', () => {
    const result = parseBlockNumberResponse({
      jsonrpc: '2.0',
      result: '0x0',
      id: 1,
    })
    expect(result).toBe(0)
  })

  test('should parse block number 16', () => {
    const result = parseBlockNumberResponse({
      jsonrpc: '2.0',
      result: '0x10',
      id: 1,
    })
    expect(result).toBe(16)
  })

  test('should parse large block number', () => {
    const result = parseBlockNumberResponse({
      jsonrpc: '2.0',
      result: '0x1000000',
      id: 1,
    })
    expect(result).toBe(16777216)
  })

  test('should throw on invalid response', () => {
    expect(() => parseBlockNumberResponse({ result: 100 })).toThrow()
  })
})

describe('parseGetCodeResponse - Contract Code Parsing', () => {
  test('should return bytecode string', () => {
    const result = parseGetCodeResponse({
      jsonrpc: '2.0',
      result: '0x6080604052',
      id: 1,
    })
    expect(result).toBe('0x6080604052')
  })

  test('should return empty code for EOA', () => {
    const result = parseGetCodeResponse({
      jsonrpc: '2.0',
      result: '0x',
      id: 1,
    })
    expect(result).toBe('0x')
  })

  test('should preserve full bytecode', () => {
    const bytecode = `0x${'ab'.repeat(100)}`
    const result = parseGetCodeResponse({
      jsonrpc: '2.0',
      result: bytecode,
      id: 1,
    })
    expect(result).toBe(bytecode)
  })
})

describe('parseLockMetadata - Lock File Parsing', () => {
  test('should parse valid lock metadata', () => {
    const result = parseLockMetadata({
      pid: 12345,
      timestamp: Date.now(),
      hostname: 'test-host',
      command: 'bun test',
    })
    expect(result.pid).toBe(12345)
    expect(result.hostname).toBe('test-host')
  })

  test('should throw on missing pid', () => {
    expect(() =>
      parseLockMetadata({
        timestamp: Date.now(),
        hostname: 'test-host',
        command: 'bun test',
      }),
    ).toThrow()
  })

  test('should throw on missing timestamp', () => {
    expect(() =>
      parseLockMetadata({
        pid: 12345,
        hostname: 'test-host',
        command: 'bun test',
      }),
    ).toThrow()
  })

  test('should throw on negative pid', () => {
    expect(() =>
      parseLockMetadata({
        pid: -1,
        timestamp: Date.now(),
        hostname: 'test-host',
        command: 'bun test',
      }),
    ).toThrow()
  })

  test('should throw on zero pid', () => {
    expect(() =>
      parseLockMetadata({
        pid: 0,
        timestamp: Date.now(),
        hostname: 'test-host',
        command: 'bun test',
      }),
    ).toThrow()
  })

  test('should throw on non-integer pid', () => {
    expect(() =>
      parseLockMetadata({
        pid: 123.45,
        timestamp: Date.now(),
        hostname: 'test-host',
        command: 'bun test',
      }),
    ).toThrow()
  })
})

describe('parseAppManifest - App Manifest Parsing', () => {
  test('should parse minimal manifest', () => {
    const result = parseAppManifest({
      ports: { main: 3000 },
    })
    expect(result.ports.main).toBe(3000)
  })

  test('should parse manifest with warmup routes', () => {
    const result = parseAppManifest({
      ports: { main: 3000 },
      warmupRoutes: ['/api', '/health'],
    })
    expect(result.warmupRoutes).toEqual(['/api', '/health'])
  })

  test('should allow additional port fields', () => {
    const result = parseAppManifest({
      ports: { main: 3000, api: 3001, ws: 3002 },
    })
    expect(result.ports.main).toBe(3000)
  })

  test('should throw on missing ports', () => {
    expect(() => parseAppManifest({})).toThrow()
  })

  test('should throw on missing main port', () => {
    expect(() =>
      parseAppManifest({
        ports: {},
      }),
    ).toThrow()
  })

  test('should throw on non-positive port', () => {
    expect(() =>
      parseAppManifest({
        ports: { main: 0 },
      }),
    ).toThrow()
  })

  test('should throw on negative port', () => {
    expect(() =>
      parseAppManifest({
        ports: { main: -1 },
      }),
    ).toThrow()
  })
})

describe('parseIpfsIdResponse - IPFS ID Response Parsing', () => {
  test('should parse valid IPFS ID response', () => {
    const result = parseIpfsIdResponse({
      ID: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    })
    expect(result.ID).toBe('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')
  })

  test('should parse response with optional fields', () => {
    const result = parseIpfsIdResponse({
      ID: 'QmTest123',
      PublicKey: 'CAASXj...',
      Addresses: ['/ip4/127.0.0.1/tcp/4001'],
      AgentVersion: 'go-ipfs/0.10.0',
      ProtocolVersion: 'ipfs/0.1.0',
    })
    expect(result.ID).toBe('QmTest123')
    expect(result.PublicKey).toBe('CAASXj...')
    expect(result.Addresses).toEqual(['/ip4/127.0.0.1/tcp/4001'])
  })

  test('should throw on missing ID', () => {
    expect(() =>
      parseIpfsIdResponse({
        PublicKey: 'key',
      }),
    ).toThrow()
  })
})

describe('parseIpfsAddResponse - IPFS Add Response Parsing', () => {
  test('should parse valid add response', () => {
    const result = parseIpfsAddResponse({
      Name: 'test.txt',
      Hash: 'QmTest123',
    })
    expect(result.Name).toBe('test.txt')
    expect(result.Hash).toBe('QmTest123')
  })

  test('should parse response with size', () => {
    const result = parseIpfsAddResponse({
      Name: 'file.bin',
      Hash: 'QmHash',
      Size: '1024',
    })
    expect(result.Size).toBe('1024')
  })

  test('should throw on missing Name', () => {
    expect(() =>
      parseIpfsAddResponse({
        Hash: 'QmHash',
      }),
    ).toThrow()
  })

  test('should throw on missing Hash', () => {
    expect(() =>
      parseIpfsAddResponse({
        Name: 'file.txt',
      }),
    ).toThrow()
  })
})

// ============================================================================
// Complex Schema Tests
// ============================================================================

describe('LockMetadataSchema - Lock Metadata Validation', () => {
  test('should accept valid metadata', () => {
    const result = LockMetadataSchema.safeParse({
      pid: 1,
      timestamp: 1,
      hostname: 'host',
      command: 'cmd',
    })
    expect(result.success).toBe(true)
  })

  test('should reject string pid', () => {
    const result = LockMetadataSchema.safeParse({
      pid: '12345',
      timestamp: Date.now(),
      hostname: 'host',
      command: 'cmd',
    })
    expect(result.success).toBe(false)
  })
})

describe('PreflightCheckSchema - Preflight Check Validation', () => {
  test('should accept minimal check result', () => {
    const result = PreflightCheckSchema.safeParse({
      name: 'RPC',
      passed: true,
      message: 'Connection successful',
    })
    expect(result.success).toBe(true)
  })

  test('should accept check with details', () => {
    const result = PreflightCheckSchema.safeParse({
      name: 'Balance',
      passed: true,
      message: '10 ETH',
      details: {
        balance: '10.0',
        minRequired: '1.0',
        sufficient: true,
      },
    })
    expect(result.success).toBe(true)
  })

  test('should reject check without name', () => {
    const result = PreflightCheckSchema.safeParse({
      passed: true,
      message: 'ok',
    })
    expect(result.success).toBe(false)
  })
})

describe('AppConfigSchema - App Configuration Validation', () => {
  test('should accept valid app config', () => {
    const result = AppConfigSchema.safeParse({
      name: 'bazaar',
      path: '/home/user/jeju/apps/bazaar',
      port: 4006,
      routes: ['/', '/markets'],
      isNextJs: true,
    })
    expect(result.success).toBe(true)
  })

  test('should reject missing routes', () => {
    const result = AppConfigSchema.safeParse({
      name: 'app',
      path: '/path',
      port: 3000,
      isNextJs: false,
    })
    expect(result.success).toBe(false)
  })

  test('should reject invalid port', () => {
    const result = AppConfigSchema.safeParse({
      name: 'app',
      path: '/path',
      port: -1,
      routes: ['/'],
      isNextJs: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('TestAccountSchema - Test Account Validation', () => {
  test('should accept valid test account', () => {
    const result = TestAccountSchema.safeParse({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      privateKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    })
    expect(result.success).toBe(true)
  })

  test('should reject invalid address', () => {
    const result = TestAccountSchema.safeParse({
      address: '0xinvalid',
      privateKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    })
    expect(result.success).toBe(false)
  })

  test('should reject invalid private key', () => {
    const result = TestAccountSchema.safeParse({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      privateKey: '0xshort',
    })
    expect(result.success).toBe(false)
  })
})

describe('NetworkConfigSchema - Network Configuration Validation', () => {
  test('should accept valid network config', () => {
    const result = NetworkConfigSchema.safeParse({
      chainId: 1337,
      chainIdHex: '0x539',
      name: 'Localnet',
      rpcUrl: 'http://127.0.0.1:6546',
      symbol: 'ETH',
    })
    expect(result.success).toBe(true)
  })

  test('should accept config with block explorer', () => {
    const result = NetworkConfigSchema.safeParse({
      chainId: 1,
      chainIdHex: '0x1',
      name: 'Ethereum',
      rpcUrl: 'https://eth.example.com',
      symbol: 'ETH',
      blockExplorerUrl: 'https://etherscan.io',
    })
    expect(result.success).toBe(true)
  })

  test('should reject invalid rpcUrl', () => {
    const result = NetworkConfigSchema.safeParse({
      chainId: 1,
      chainIdHex: '0x1',
      name: 'Test',
      rpcUrl: 'not-a-url',
      symbol: 'ETH',
    })
    expect(result.success).toBe(false)
  })

  test('should reject non-positive chainId', () => {
    const result = NetworkConfigSchema.safeParse({
      chainId: 0,
      chainIdHex: '0x0',
      name: 'Test',
      rpcUrl: 'http://localhost:6545',
      symbol: 'ETH',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Edge Cases and Boundary Conditions
// ============================================================================

describe('Schema Edge Cases', () => {
  test('should handle maximum safe integer for chain ID', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0x1FFFFFFFFFFFFF', // Max safe integer
      id: 1,
    })
    expect(result).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('should handle leading zeros in hex', () => {
    const result = parseBlockNumberResponse({
      jsonrpc: '2.0',
      result: '0x0000000000000010',
      id: 1,
    })
    expect(result).toBe(16)
  })

  test('should handle single digit hex', () => {
    const result = parseChainIdResponse({
      jsonrpc: '2.0',
      result: '0x1',
      id: 1,
    })
    expect(result).toBe(1)
  })

  test('AddressSchema rejects improperly checksummed mixed case', () => {
    // Mixed-case addresses must be properly EIP-55 checksummed
    const result = AddressSchema.safeParse(
      '0xAaBbCcDdEeFf0011223344556677889900aAbBcC',
    )
    expect(result.success).toBe(false)
  })

  test('should handle empty warmup routes array', () => {
    const result = parseAppManifest({
      ports: { main: 3000 },
      warmupRoutes: [],
    })
    expect(result.warmupRoutes).toEqual([])
  })
})
