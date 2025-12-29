/**
 * @fileoverview Comprehensive tests for chain.ts
 *
 * Tests cover:
 * - NetworkSchema: Network type validation
 * - ChainConfigSchema: Chain configuration validation
 * - OPStackConfigSchema: OP Stack configuration validation
 * - RethConfigSchema: Reth configuration validation
 * - JejuDAConfigSchema: DA configuration validation
 * - FlashblocksConfigSchema: Flashblocks configuration validation
 * - GenesisConfigSchema: Genesis configuration validation
 * - RollupConfigSchema: Rollup configuration validation
 */

import { describe, expect, test } from 'bun:test'
import {
  type ChainConfig,
  ChainConfigSchema,
  type FlashblocksConfig,
  FlashblocksConfigSchema,
  type GenesisConfig,
  GenesisConfigSchema,
  type JejuDAConfig,
  JejuDAConfigSchema,
  NetworkSchema,
  type NetworkType,
  type OPStackConfig,
  OPStackConfigSchema,
  type RethConfig,
  RethConfigSchema,
  type RollupConfig,
  RollupConfigSchema,
  type TransactionLog,
} from '../chain'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as const

describe('NetworkSchema', () => {
  const validNetworks: NetworkType[] = ['localnet', 'testnet', 'mainnet']
  const invalidNetworks = ['devnet', 'staging', 'production', '']

  test.each(validNetworks)('accepts valid network: %s', (network) => {
    expect(NetworkSchema.safeParse(network).success).toBe(true)
  })

  test.each(invalidNetworks)('rejects invalid network: %s', (network) => {
    expect(NetworkSchema.safeParse(network).success).toBe(false)
  })
})

describe('ChainConfigSchema', () => {
  const validChainConfig: ChainConfig = {
    chainId: 420690,
    networkId: 420690,
    name: 'Jeju Testnet',
    rpcUrl: 'https://rpc.testnet.jejunetwork.org',
    wsUrl: 'wss://ws.testnet.jejunetwork.org',
    explorerUrl: 'https://explorer.testnet.jejunetwork.org',
    l1ChainId: 11155111,
    l1RpcUrl: 'https://sepolia.infura.io/v3/key',
    l1Name: 'Sepolia',
    flashblocksEnabled: true,
    flashblocksSubBlockTime: 200,
    blockTime: 2000,
    gasToken: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      l2: {
        L2CrossDomainMessenger: TEST_ADDRESS,
        L2StandardBridge: TEST_ADDRESS,
        L2ToL1MessagePasser: TEST_ADDRESS,
        L2ERC721Bridge: TEST_ADDRESS,
        GasPriceOracle: TEST_ADDRESS,
        L1Block: TEST_ADDRESS,
        WETH: TEST_ADDRESS,
      },
      l1: {
        OptimismPortal: TEST_ADDRESS,
        L2OutputOracle: TEST_ADDRESS,
        L1CrossDomainMessenger: TEST_ADDRESS,
        L1StandardBridge: TEST_ADDRESS,
        SystemConfig: TEST_ADDRESS,
      },
    },
  }

  test('accepts valid chain config', () => {
    const result = ChainConfigSchema.safeParse(validChainConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.chainId).toBe(420690)
      expect(result.data.flashblocksEnabled).toBe(true)
    }
  })

  test('accepts empty L1 contract addresses', () => {
    const config = {
      ...validChainConfig,
      contracts: {
        ...validChainConfig.contracts,
        l1: {
          OptimismPortal: '',
          L2OutputOracle: '',
          L1CrossDomainMessenger: '',
          L1StandardBridge: '',
          SystemConfig: '',
        },
      },
    }

    const result = ChainConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  test('rejects invalid L2 contract address', () => {
    const config = {
      ...validChainConfig,
      contracts: {
        ...validChainConfig.contracts,
        l2: {
          ...validChainConfig.contracts.l2,
          L2StandardBridge: 'invalid',
        },
      },
    }
    expect(ChainConfigSchema.safeParse(config).success).toBe(false)
  })

  test('rejects missing gas token', () => {
    const { gasToken, ...configWithoutGasToken } = validChainConfig
    expect(ChainConfigSchema.safeParse(configWithoutGasToken).success).toBe(
      false,
    )
  })
})

describe('OPStackConfigSchema', () => {
  const validOPStackConfig: OPStackConfig = {
    opNode: {
      image: 'us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node',
      version: 'v1.7.0',
      p2pPort: 9003,
      rpcPort: 8547,
      metricsPort: 7300,
    },
    opBatcher: {
      image: 'us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher',
      version: 'v1.7.0',
      maxChannelDuration: 1,
      subSafetyMargin: 10,
      pollInterval: '1s',
      numConfirmations: 1,
      daProvider: 'jeju-da',
    },
    opProposer: {
      image: 'us-docker.pkg.dev/oplabs-tools-artifacts/images/op-proposer',
      version: 'v1.7.0',
      pollInterval: '6s',
      numConfirmations: 1,
    },
    opChallenger: {
      image: 'us-docker.pkg.dev/oplabs-tools-artifacts/images/op-challenger',
      version: 'v1.7.0',
      pollInterval: '12s',
    },
    opConductor: {
      enabled: false,
      image: 'us-docker.pkg.dev/oplabs-tools-artifacts/images/op-conductor',
      version: 'v1.7.0',
      consensusPort: 8088,
      healthCheckPort: 8089,
    },
  }

  test('accepts valid OP Stack config', () => {
    const result = OPStackConfigSchema.safeParse(validOPStackConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.opBatcher.daProvider).toBe('jeju-da')
    }
  })

  test('accepts different DA providers', () => {
    const providers = ['jeju-da', 'ethereum-blobs', 'calldata'] as const
    for (const daProvider of providers) {
      const config = {
        ...validOPStackConfig,
        opBatcher: {
          ...validOPStackConfig.opBatcher,
          daProvider,
        },
      }
      expect(OPStackConfigSchema.safeParse(config).success).toBe(true)
    }
  })

  test('rejects invalid DA provider', () => {
    const config = {
      ...validOPStackConfig,
      opBatcher: {
        ...validOPStackConfig.opBatcher,
        daProvider: 'invalid',
      },
    }
    expect(OPStackConfigSchema.safeParse(config).success).toBe(false)
  })
})

describe('RethConfigSchema', () => {
  const validRethConfig: RethConfig = {
    image: 'ghcr.io/paradigmxyz/reth',
    version: 'v1.0.0',
    httpPort: 8545,
    wsPort: 8546,
    p2pPort: 30303,
    metricsPort: 9001,
    enginePort: 8551,
    maxPeers: 50,
    pruning: 'full',
  }

  test('accepts valid Reth config', () => {
    const result = RethConfigSchema.safeParse(validRethConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pruning).toBe('full')
    }
  })

  test('accepts archive pruning mode', () => {
    const config = {
      ...validRethConfig,
      pruning: 'archive',
    }
    const result = RethConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  test('rejects invalid pruning mode', () => {
    const config = {
      ...validRethConfig,
      pruning: 'light',
    }
    expect(RethConfigSchema.safeParse(config).success).toBe(false)
  })
})

describe('JejuDAConfigSchema', () => {
  const validDAConfig: JejuDAConfig = {
    enabled: true,
    serverImage: 'ghcr.io/jeju/da-server',
    serverVersion: 'v1.0.0',
    serverUrl: 'https://da.jejunetwork.org',
    ipfsApiUrl: 'http://localhost:5001',
    ipfsGatewayUrl: 'https://ipfs.jejunetwork.org',
    peerdasEnabled: false,
    minConfirmations: 3,
  }

  test('accepts valid DA config', () => {
    const result = JejuDAConfigSchema.safeParse(validDAConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
      expect(result.data.minConfirmations).toBe(3)
    }
  })

  test('accepts disabled DA config', () => {
    const config = {
      ...validDAConfig,
      enabled: false,
    }
    const result = JejuDAConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })
})

describe('FlashblocksConfigSchema', () => {
  const validFlashblocksConfig: FlashblocksConfig = {
    enabled: true,
    subBlockTime: 200,
    leaderElection: {
      enabled: true,
      heartbeatInterval: 100,
      electionTimeout: 500,
    },
    sequencerFollowers: 2,
  }

  test('accepts valid Flashblocks config', () => {
    const result = FlashblocksConfigSchema.safeParse(validFlashblocksConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.subBlockTime).toBe(200)
      expect(result.data.leaderElection.enabled).toBe(true)
    }
  })

  test('accepts disabled Flashblocks config', () => {
    const config = {
      ...validFlashblocksConfig,
      enabled: false,
    }
    const result = FlashblocksConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })
})

describe('GenesisConfigSchema', () => {
  const validGenesisConfig: GenesisConfig = {
    timestamp: 1700000000,
    gasLimit: 30000000,
    difficulty: 1,
    extraData: '0x00',
    baseFeePerGas: '1000000000',
  }

  test('accepts valid genesis config', () => {
    const result = GenesisConfigSchema.safeParse(validGenesisConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.gasLimit).toBe(30000000)
    }
  })

  test('accepts genesis config with L1 info', () => {
    const config = {
      ...validGenesisConfig,
      l1BlockHash: `0x${'a'.repeat(64)}`,
      l1BlockNumber: 18000000,
    }
    const result = GenesisConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.l1BlockNumber).toBe(18000000)
    }
  })
})

describe('RollupConfigSchema', () => {
  const validRollupConfig: RollupConfig = {
    genesis: {
      timestamp: 1700000000,
      gasLimit: 30000000,
      difficulty: 1,
      extraData: '0x00',
      baseFeePerGas: '1000000000',
    },
    blockTime: 2,
    maxSequencerDrift: 600,
    sequencerWindowSize: 3600,
    channelTimeout: 300,
    l1ChainId: 1,
    l2ChainId: 420690,
    batchInboxAddress: TEST_ADDRESS,
    depositContractAddress: TEST_ADDRESS,
    l1SystemConfigAddress: TEST_ADDRESS,
  }

  test('accepts valid rollup config', () => {
    const result = RollupConfigSchema.safeParse(validRollupConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.l2ChainId).toBe(420690)
      expect(result.data.blockTime).toBe(2)
    }
  })

  test('rejects missing genesis', () => {
    const { genesis, ...configWithoutGenesis } = validRollupConfig
    expect(RollupConfigSchema.safeParse(configWithoutGenesis).success).toBe(
      false,
    )
  })
})

describe('TransactionLog interface', () => {
  test('has correct structure', () => {
    const log: TransactionLog = {
      address: TEST_ADDRESS as `0x${string}`,
      blockHash: `0x${'a'.repeat(64)}` as `0x${string}`,
      blockNumber: 12345678n,
      data: '0x1234' as `0x${string}`,
      logIndex: 0,
      transactionHash: `0x${'b'.repeat(64)}` as `0x${string}`,
      transactionIndex: 5,
      removed: false,
      topics: [`0x${'c'.repeat(64)}` as `0x${string}`],
    }

    expect(log.address).toBe(TEST_ADDRESS)
    expect(log.blockNumber).toBe(12345678n)
    expect(log.removed).toBe(false)
    expect(log.topics.length).toBe(1)
  })
})
