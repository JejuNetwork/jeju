/**
 * @fileoverview Comprehensive tests for contracts.ts
 *
 * Tests cover:
 * - L1ContractsSchema: L1 bridge contract addresses
 * - L2ContractsSchema: L2 bridge contract addresses
 * - HyperlaneContractsSchema: Hyperlane interop contracts
 * - UniswapV4ContractsSchema: Uniswap V4 contracts
 * - SynthetixV3ContractsSchema: Synthetix V3 contracts
 * - CompoundV3ContractsSchema: Compound V3 contracts
 * - ChainlinkContractsSchema: Chainlink price feed contracts
 * - ERC4337ContractsSchema: Account abstraction contracts
 * - GovernanceContractsSchema: DAO governance contracts
 * - DeploymentSchema: Full deployment manifest
 */

import { describe, expect, test } from 'bun:test'
import {
  ChainlinkContractsSchema,
  CompoundV3ContractsSchema,
  type Deployment,
  DeploymentSchema,
  ERC4337ContractsSchema,
  GovernanceContractsSchema,
  HyperlaneContractsSchema,
  L1ContractsSchema,
  L2ContractsSchema,
  SynthetixV3ContractsSchema,
  type TransactionStatus,
  UniswapV4ContractsSchema,
} from '../contracts'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
const _ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('TransactionStatus type', () => {
  test('allows valid status values', () => {
    const statuses: TransactionStatus[] = [
      'pending',
      'submitted',
      'confirming',
      'confirmed',
      'failed',
      'cancelled',
    ]

    expect(statuses.length).toBe(6)
  })
})

describe('L1ContractsSchema', () => {
  const validL1Contracts = {
    OptimismPortal: TEST_ADDRESS,
    L2OutputOracle: TEST_ADDRESS,
    L1CrossDomainMessenger: TEST_ADDRESS,
    L1StandardBridge: TEST_ADDRESS,
    L1ERC721Bridge: TEST_ADDRESS,
    SystemConfig: TEST_ADDRESS,
    AddressManager: TEST_ADDRESS,
    ProxyAdmin: TEST_ADDRESS,
  }

  test('accepts valid L1 contracts', () => {
    const result = L1ContractsSchema.safeParse(validL1Contracts)
    expect(result.success).toBe(true)
  })

  test('accepts optional DisputeGameFactory', () => {
    const contracts = {
      ...validL1Contracts,
      DisputeGameFactory: TEST_ADDRESS,
    }
    const result = L1ContractsSchema.safeParse(contracts)
    expect(result.success).toBe(true)
  })

  test('rejects invalid address', () => {
    const contracts = {
      ...validL1Contracts,
      OptimismPortal: '0xinvalid',
    }
    expect(L1ContractsSchema.safeParse(contracts).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    const { OptimismPortal, ...withoutPortal } = validL1Contracts
    expect(L1ContractsSchema.safeParse(withoutPortal).success).toBe(false)
  })
})

describe('L2ContractsSchema', () => {
  const validL2Contracts = {
    L2CrossDomainMessenger: TEST_ADDRESS,
    L2StandardBridge: TEST_ADDRESS,
    L2ERC721Bridge: TEST_ADDRESS,
    L2ToL1MessagePasser: TEST_ADDRESS,
    GasPriceOracle: TEST_ADDRESS,
    L1Block: TEST_ADDRESS,
    WETH: TEST_ADDRESS,
  }

  test('accepts valid L2 contracts', () => {
    const result = L2ContractsSchema.safeParse(validL2Contracts)
    expect(result.success).toBe(true)
  })

  test('rejects invalid address', () => {
    const contracts = {
      ...validL2Contracts,
      WETH: 'not-an-address',
    }
    expect(L2ContractsSchema.safeParse(contracts).success).toBe(false)
  })
})

describe('HyperlaneContractsSchema', () => {
  const validHyperlane = {
    Mailbox: TEST_ADDRESS,
    InterchainGasPaymaster: TEST_ADDRESS,
    ValidatorAnnounce: TEST_ADDRESS,
    MultisigIsm: TEST_ADDRESS,
    InterchainSecurityModule: TEST_ADDRESS,
    domainId: 420690,
  }

  test('accepts valid Hyperlane contracts', () => {
    const result = HyperlaneContractsSchema.safeParse(validHyperlane)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.domainId).toBe(420690)
    }
  })

  test('rejects non-numeric domainId', () => {
    const contracts = {
      ...validHyperlane,
      domainId: 'not-a-number',
    }
    expect(HyperlaneContractsSchema.safeParse(contracts).success).toBe(false)
  })
})

describe('UniswapV4ContractsSchema', () => {
  const validUniswap = {
    PoolManager: TEST_ADDRESS,
    SwapRouter: TEST_ADDRESS,
    PositionManager: TEST_ADDRESS,
    QuoterV4: TEST_ADDRESS,
    StateView: TEST_ADDRESS,
  }

  test('accepts valid Uniswap V4 contracts', () => {
    const result = UniswapV4ContractsSchema.safeParse(validUniswap)
    expect(result.success).toBe(true)
  })
})

describe('SynthetixV3ContractsSchema', () => {
  const validSynthetix = {
    CoreProxy: TEST_ADDRESS,
    AccountProxy: TEST_ADDRESS,
    USDProxy: TEST_ADDRESS,
    PerpsMarketProxy: TEST_ADDRESS,
    SpotMarketProxy: TEST_ADDRESS,
    OracleManager: TEST_ADDRESS,
  }

  test('accepts valid Synthetix V3 contracts', () => {
    const result = SynthetixV3ContractsSchema.safeParse(validSynthetix)
    expect(result.success).toBe(true)
  })
})

describe('CompoundV3ContractsSchema', () => {
  const validCompound = {
    Comet: TEST_ADDRESS,
    CometRewards: TEST_ADDRESS,
    Configurator: TEST_ADDRESS,
    ProxyAdmin: TEST_ADDRESS,
  }

  test('accepts valid Compound V3 contracts', () => {
    const result = CompoundV3ContractsSchema.safeParse(validCompound)
    expect(result.success).toBe(true)
  })
})

describe('ChainlinkContractsSchema', () => {
  const validChainlink = {
    feeds: {
      'ETH/USD': {
        address: TEST_ADDRESS,
        heartbeat: 3600,
        decimals: 8,
      },
      'BTC/USD': {
        address: TEST_ADDRESS,
        heartbeat: 3600,
        decimals: 8,
      },
    },
  }

  test('accepts valid Chainlink contracts', () => {
    const result = ChainlinkContractsSchema.safeParse(validChainlink)
    expect(result.success).toBe(true)
  })

  test('accepts empty feeds', () => {
    const contracts = { feeds: {} }
    const result = ChainlinkContractsSchema.safeParse(contracts)
    expect(result.success).toBe(true)
  })

  test('rejects invalid feed structure', () => {
    const contracts = {
      feeds: {
        'ETH/USD': {
          address: 'invalid',
          heartbeat: 3600,
          decimals: 8,
        },
      },
    }
    expect(ChainlinkContractsSchema.safeParse(contracts).success).toBe(false)
  })
})

describe('ERC4337ContractsSchema', () => {
  const validERC4337 = {
    EntryPoint: TEST_ADDRESS,
    AccountFactory: TEST_ADDRESS,
    Paymaster: TEST_ADDRESS,
  }

  test('accepts valid ERC4337 contracts', () => {
    const result = ERC4337ContractsSchema.safeParse(validERC4337)
    expect(result.success).toBe(true)
  })

  test('accepts optional PaymasterVerifier', () => {
    const contracts = {
      ...validERC4337,
      PaymasterVerifier: TEST_ADDRESS,
    }
    const result = ERC4337ContractsSchema.safeParse(contracts)
    expect(result.success).toBe(true)
  })
})

describe('GovernanceContractsSchema', () => {
  const validGovernance = {
    Safe: TEST_ADDRESS,
    Governor: TEST_ADDRESS,
    TimelockController: TEST_ADDRESS,
    GovernanceToken: TEST_ADDRESS,
  }

  test('accepts valid Governance contracts', () => {
    const result = GovernanceContractsSchema.safeParse(validGovernance)
    expect(result.success).toBe(true)
  })
})

describe('DeploymentSchema', () => {
  const validL1 = {
    OptimismPortal: TEST_ADDRESS,
    L2OutputOracle: TEST_ADDRESS,
    L1CrossDomainMessenger: TEST_ADDRESS,
    L1StandardBridge: TEST_ADDRESS,
    L1ERC721Bridge: TEST_ADDRESS,
    SystemConfig: TEST_ADDRESS,
    AddressManager: TEST_ADDRESS,
    ProxyAdmin: TEST_ADDRESS,
  }

  const validL2 = {
    L2CrossDomainMessenger: TEST_ADDRESS,
    L2StandardBridge: TEST_ADDRESS,
    L2ERC721Bridge: TEST_ADDRESS,
    L2ToL1MessagePasser: TEST_ADDRESS,
    GasPriceOracle: TEST_ADDRESS,
    L1Block: TEST_ADDRESS,
    WETH: TEST_ADDRESS,
  }

  const validDeployment: Deployment = {
    network: 'testnet',
    timestamp: Date.now(),
    deployer: TEST_ADDRESS,
    l1Contracts: validL1,
    l2Contracts: validL2,
  }

  test('accepts minimal deployment', () => {
    const result = DeploymentSchema.safeParse(validDeployment)
    expect(result.success).toBe(true)
  })

  test('accepts full deployment with all optional contracts', () => {
    const deployment = {
      ...validDeployment,
      hyperlane: {
        Mailbox: TEST_ADDRESS,
        InterchainGasPaymaster: TEST_ADDRESS,
        ValidatorAnnounce: TEST_ADDRESS,
        MultisigIsm: TEST_ADDRESS,
        InterchainSecurityModule: TEST_ADDRESS,
        domainId: 420690,
      },
      uniswapV4: {
        PoolManager: TEST_ADDRESS,
        SwapRouter: TEST_ADDRESS,
        PositionManager: TEST_ADDRESS,
        QuoterV4: TEST_ADDRESS,
        StateView: TEST_ADDRESS,
      },
      erc4337: {
        EntryPoint: TEST_ADDRESS,
        AccountFactory: TEST_ADDRESS,
        Paymaster: TEST_ADDRESS,
      },
      governance: {
        Safe: TEST_ADDRESS,
        Governor: TEST_ADDRESS,
        TimelockController: TEST_ADDRESS,
        GovernanceToken: TEST_ADDRESS,
      },
    }

    const result = DeploymentSchema.safeParse(deployment)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hyperlane?.domainId).toBe(420690)
    }
  })

  test('rejects missing required fields', () => {
    const { l1Contracts, ...withoutL1 } = validDeployment
    expect(DeploymentSchema.safeParse(withoutL1).success).toBe(false)
  })
})
