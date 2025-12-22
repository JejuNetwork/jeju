/**
 * Unit tests for shared deployment utilities
 *
 * Tests network validation, command validation factory, and RPC URL resolution.
 * Uses property-based testing for thorough coverage.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

// ============ Types & Schemas (re-exported for testing) ============

const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet'])
type NetworkType = z.infer<typeof NetworkSchema>

interface NetworkRpcConfig {
  rpcUrlEnvVar: string
  chainId: number
  name: string
  defaultLocalnet?: string
}

const NETWORK_RPC_CONFIGS: Record<NetworkType, NetworkRpcConfig> = {
  testnet: {
    rpcUrlEnvVar: 'JEJU_TESTNET_RPC_URL',
    chainId: 11235813,
    name: 'Testnet',
  },
  mainnet: {
    rpcUrlEnvVar: 'JEJU_MAINNET_RPC_URL',
    chainId: 11235814,
    name: 'Mainnet',
  },
  localnet: {
    rpcUrlEnvVar: 'JEJU_LOCALNET_RPC_URL',
    chainId: 31337,
    name: 'Localnet',
    defaultLocalnet: 'http://localhost:9545',
  },
}

// ============ Functions Under Test ============

function getRequiredNetwork(
  env: Record<string, string | undefined>,
): NetworkType {
  const network = env.NETWORK
  const result = NetworkSchema.safeParse(network)
  if (!result.success) {
    throw new Error(
      `NETWORK environment variable is required. Set to: localnet, testnet, mainnet` +
        (network ? ` (got: ${network})` : ''),
    )
  }
  return result.data
}

function createCommandValidator<T extends readonly [string, ...string[]]>(
  validCommands: T,
  scriptName: string,
): (argv: string[]) => T[number] {
  const CommandSchema = z.enum(validCommands)
  return (argv: string[]): T[number] => {
    const command = argv[2]
    const result = CommandSchema.safeParse(command)
    if (!result.success) {
      throw new Error(
        `Command required. Usage: bun run ${scriptName} <command>\n` +
          `Valid commands: ${validCommands.join(', ')}` +
          (command ? `\n(got: ${command})` : ''),
      )
    }
    return result.data
  }
}

function getNetworkRpcUrl(
  network: NetworkType,
  env: Record<string, string | undefined>,
): string {
  const config = NETWORK_RPC_CONFIGS[network]
  const rpcUrl = env[config.rpcUrlEnvVar]

  if (rpcUrl) {
    return rpcUrl
  }

  if (config.defaultLocalnet) {
    return config.defaultLocalnet
  }

  throw new Error(
    `${config.rpcUrlEnvVar} environment variable is required for ${network}`,
  )
}

// ============ Tests ============

describe('NetworkSchema', () => {
  it('should accept valid network values', () => {
    expect(NetworkSchema.parse('localnet')).toBe('localnet')
    expect(NetworkSchema.parse('testnet')).toBe('testnet')
    expect(NetworkSchema.parse('mainnet')).toBe('mainnet')
  })

  it('should reject invalid network values', () => {
    expect(() => NetworkSchema.parse('invalid')).toThrow()
    expect(() => NetworkSchema.parse('')).toThrow()
    expect(() => NetworkSchema.parse(null)).toThrow()
    expect(() => NetworkSchema.parse(undefined)).toThrow()
    expect(() => NetworkSchema.parse(123)).toThrow()
  })

  it('should be case-sensitive', () => {
    expect(() => NetworkSchema.parse('TESTNET')).toThrow()
    expect(() => NetworkSchema.parse('Localnet')).toThrow()
    expect(() => NetworkSchema.parse('MainNet')).toThrow()
  })

  it('should reject similar but incorrect values', () => {
    expect(() => NetworkSchema.parse('local')).toThrow()
    expect(() => NetworkSchema.parse('test')).toThrow()
    expect(() => NetworkSchema.parse('main')).toThrow()
    expect(() => NetworkSchema.parse('localnet ')).toThrow()
    expect(() => NetworkSchema.parse(' testnet')).toThrow()
  })
})

describe('getRequiredNetwork', () => {
  it('should return valid network from environment', () => {
    expect(getRequiredNetwork({ NETWORK: 'localnet' })).toBe('localnet')
    expect(getRequiredNetwork({ NETWORK: 'testnet' })).toBe('testnet')
    expect(getRequiredNetwork({ NETWORK: 'mainnet' })).toBe('mainnet')
  })

  it('should throw when NETWORK is missing', () => {
    expect(() => getRequiredNetwork({})).toThrow(
      'NETWORK environment variable is required',
    )
  })

  it('should throw when NETWORK is undefined', () => {
    expect(() => getRequiredNetwork({ NETWORK: undefined })).toThrow(
      'NETWORK environment variable is required',
    )
  })

  it('should throw with helpful message for invalid network', () => {
    expect(() => getRequiredNetwork({ NETWORK: 'production' })).toThrow(
      '(got: production)',
    )
  })

  it("should throw without 'got:' when value is empty string", () => {
    expect(() => getRequiredNetwork({ NETWORK: '' })).toThrow()
  })
})

describe('createCommandValidator', () => {
  const VALID_COMMANDS = ['init', 'plan', 'apply', 'destroy'] as const

  it('should create a validator that accepts valid commands', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'test.ts')

    expect(validate(['bun', 'test.ts', 'init'])).toBe('init')
    expect(validate(['bun', 'test.ts', 'plan'])).toBe('plan')
    expect(validate(['bun', 'test.ts', 'apply'])).toBe('apply')
    expect(validate(['bun', 'test.ts', 'destroy'])).toBe('destroy')
  })

  it('should throw for invalid commands', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'test.ts')

    expect(() => validate(['bun', 'test.ts', 'invalid'])).toThrow(
      'Command required',
    )
  })

  it('should throw when no command provided', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'test.ts')

    expect(() => validate(['bun', 'test.ts'])).toThrow('Command required')
  })

  it('should include script name in error message', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'my-script.ts')

    expect(() => validate(['bun', 'my-script.ts', 'bad'])).toThrow(
      'my-script.ts',
    )
  })

  it('should list valid commands in error message', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'test.ts')

    expect(() => validate(['bun', 'test.ts', 'bad'])).toThrow(
      'init, plan, apply, destroy',
    )
  })

  it('should show provided command in error when invalid', () => {
    const validate = createCommandValidator(VALID_COMMANDS, 'test.ts')

    expect(() => validate(['bun', 'test.ts', 'unknown'])).toThrow(
      '(got: unknown)',
    )
  })

  it('should work with single-command list', () => {
    const validate = createCommandValidator(['only'] as const, 'test.ts')

    expect(validate(['bun', 'test.ts', 'only'])).toBe('only')
    expect(() => validate(['bun', 'test.ts', 'other'])).toThrow()
  })

  it('should work with different command sets', () => {
    const helmCommands = [
      'diff',
      'sync',
      'apply',
      'destroy',
      'status',
      'list',
    ] as const
    const validate = createCommandValidator(helmCommands, 'helmfile.ts')

    expect(validate(['bun', 'helmfile.ts', 'sync'])).toBe('sync')
    expect(validate(['bun', 'helmfile.ts', 'diff'])).toBe('diff')
    expect(() => validate(['bun', 'helmfile.ts', 'init'])).toThrow()
  })
})

describe('getNetworkRpcUrl', () => {
  it('should return env var value when set for testnet', () => {
    const url = getNetworkRpcUrl('testnet', {
      JEJU_TESTNET_RPC_URL: 'https://testnet.example.com',
    })
    expect(url).toBe('https://testnet.example.com')
  })

  it('should return env var value when set for mainnet', () => {
    const url = getNetworkRpcUrl('mainnet', {
      JEJU_MAINNET_RPC_URL: 'https://mainnet.example.com',
    })
    expect(url).toBe('https://mainnet.example.com')
  })

  it('should return default localhost for localnet when env not set', () => {
    const url = getNetworkRpcUrl('localnet', {})
    expect(url).toBe('http://localhost:9545')
  })

  it('should prefer env var over default for localnet', () => {
    const url = getNetworkRpcUrl('localnet', {
      JEJU_LOCALNET_RPC_URL: 'http://custom:8545',
    })
    expect(url).toBe('http://custom:8545')
  })

  it('should throw when testnet env var missing', () => {
    expect(() => getNetworkRpcUrl('testnet', {})).toThrow(
      'JEJU_TESTNET_RPC_URL environment variable is required for testnet',
    )
  })

  it('should throw when mainnet env var missing', () => {
    expect(() => getNetworkRpcUrl('mainnet', {})).toThrow(
      'JEJU_MAINNET_RPC_URL environment variable is required for mainnet',
    )
  })

  it('should not throw for localnet even without env var', () => {
    expect(() => getNetworkRpcUrl('localnet', {})).not.toThrow()
  })
})

describe('NETWORK_RPC_CONFIGS', () => {
  it('should have correct chain IDs', () => {
    expect(NETWORK_RPC_CONFIGS.testnet.chainId).toBe(11235813)
    expect(NETWORK_RPC_CONFIGS.mainnet.chainId).toBe(11235814)
    expect(NETWORK_RPC_CONFIGS.localnet.chainId).toBe(31337)
  })

  it('should have unique chain IDs for each network', () => {
    const chainIds = Object.values(NETWORK_RPC_CONFIGS).map((c) => c.chainId)
    const uniqueChainIds = new Set(chainIds)
    expect(uniqueChainIds.size).toBe(chainIds.length)
  })

  it('should have unique env var names', () => {
    const envVars = Object.values(NETWORK_RPC_CONFIGS).map(
      (c) => c.rpcUrlEnvVar,
    )
    const uniqueEnvVars = new Set(envVars)
    expect(uniqueEnvVars.size).toBe(envVars.length)
  })

  it('should only have defaultLocalnet for localnet', () => {
    expect(NETWORK_RPC_CONFIGS.localnet.defaultLocalnet).toBeDefined()
    expect(NETWORK_RPC_CONFIGS.testnet.defaultLocalnet).toBeUndefined()
    expect(NETWORK_RPC_CONFIGS.mainnet.defaultLocalnet).toBeUndefined()
  })

  it('should have valid localhost URL for localnet default', () => {
    const url = NETWORK_RPC_CONFIGS.localnet.defaultLocalnet
    expect(url).toMatch(/^http:\/\/localhost:\d+$/)
  })
})

describe('Property-based tests for validation', () => {
  it('should reject all non-string inputs for network', () => {
    const invalidInputs = [
      null,
      undefined,
      123,
      true,
      false,
      {},
      [],
      Symbol('test'),
      () => {
        /* test function */
      },
    ]

    for (const input of invalidInputs) {
      expect(() => NetworkSchema.parse(input)).toThrow()
    }
  })

  it('should reject strings with leading/trailing whitespace', () => {
    const networks = ['localnet', 'testnet', 'mainnet']

    for (const network of networks) {
      expect(() => NetworkSchema.parse(` ${network}`)).toThrow()
      expect(() => NetworkSchema.parse(`${network} `)).toThrow()
      expect(() => NetworkSchema.parse(` ${network} `)).toThrow()
      expect(() => NetworkSchema.parse(`\t${network}`)).toThrow()
      expect(() => NetworkSchema.parse(`${network}\n`)).toThrow()
    }
  })

  it('should be consistent with arbitrary valid network selections', () => {
    const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet']

    for (let i = 0; i < 100; i++) {
      const randomNetwork =
        networks[Math.floor(Math.random() * networks.length)]
      expect(getRequiredNetwork({ NETWORK: randomNetwork })).toBe(randomNetwork)
    }
  })
})

describe('Edge cases', () => {
  it('should handle command validator with extra argv elements', () => {
    const validate = createCommandValidator(['run'] as const, 'test.ts')

    // Extra args after command should be ignored by validator
    expect(validate(['bun', 'test.ts', 'run', '--flag', 'value'])).toBe('run')
  })

  it('should handle empty env object', () => {
    expect(() => getRequiredNetwork({})).toThrow()
    expect(() => getNetworkRpcUrl('testnet', {})).toThrow()
    expect(getNetworkRpcUrl('localnet', {})).toBe('http://localhost:9545')
  })

  it('should handle env with unrelated keys', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      RANDOM_KEY: 'value',
    }

    expect(() => getRequiredNetwork(env)).toThrow()
  })

  it('should correctly use the right env var for each network', () => {
    const env = {
      JEJU_TESTNET_RPC_URL: 'testnet-url',
      JEJU_MAINNET_RPC_URL: 'mainnet-url',
      JEJU_LOCALNET_RPC_URL: 'localnet-url',
    }

    expect(getNetworkRpcUrl('testnet', env)).toBe('testnet-url')
    expect(getNetworkRpcUrl('mainnet', env)).toBe('mainnet-url')
    expect(getNetworkRpcUrl('localnet', env)).toBe('localnet-url')
  })
})
