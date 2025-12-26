/**
 * @fileoverview Contract ABI exports
 * @module @jejunetwork/contracts/abis
 *
 * TYPED ABIs (camelCase) - Re-exported from generated.ts with full viem type inference
 * DEPRECATED ABIs (PascalCase) - Cast to Abi, no type inference (kept for backward compatibility)
 *
 * Always use typed ABIs (camelCase):
 * ```typescript
 * import { identityRegistryAbi } from '@jejunetwork/contracts'
 * ```
 */

// ============================================================================
// TYPED ABIs - Export from generated (full type inference)
// ============================================================================
export {
  automationRegistryAbi,
  banManagerAbi,
  bondingCurveAbi,
  chainlinkGovernanceAbi,
  creditManagerAbi,
  federatedIdentityAbi,
  federatedLiquidityAbi,
  federatedSolverAbi,
  hyperlaneOracleAbi,
  icoPresaleAbi,
  identityRegistryAbi,
  inputSettlerAbi,
  launchpadTokenAbi,
  liquidityPaymasterAbi,
  liquidityVaultAbi,
  lpLockerAbi,
  mockErc20Abi,
  moderationMarketplaceAbi,
  multiTokenPaymasterAbi,
  networkRegistryAbi,
  oracleRegistryAbi,
  oracleRouterAbi,
  otcAbi,
  outputSettlerAbi,
  paymasterFactoryAbi,
  registrationHelperAbi,
  reputationRegistryAbi,
  simplePoolOracleAbi,
  solverRegistryAbi,
  tokenLaunchpadAbi,
  tokenRegistryAbi,
  userBlockRegistryAbi,
  validationRegistryAbi,
  vrfCoordinatorV2_5Abi,
} from '../generated'

// ============================================================================
// DEPRECATED ABIs - JSON imports cast to Abi (no type inference)
// Use camelCase typed exports from '../generated' instead
// ============================================================================
import type { Abi } from 'viem'
import AppTokenPreferenceAbiJson from '../../abis/AppTokenPreference.json' with { type: 'json' }
import AutomationRegistryAbiJson from '../../abis/AutomationRegistry.json' with { type: 'json' }
import BanManagerAbiJson from '../../abis/BanManager.json' with { type: 'json' }
import BazaarAbiJson from '../../abis/Bazaar.json' with { type: 'json' }
import BondingCurveAbiJson from '../../abis/BondingCurve.json' with { type: 'json' }
import ChainlinkGovernanceAbiJson from '../../abis/ChainlinkGovernance.json' with { type: 'json' }
import CreditManagerAbiJson from '../../abis/CreditManager.json' with { type: 'json' }
import ERC20AbiJson from '../../abis/ERC20.json' with { type: 'json' }
import ERC20FactoryAbiJson from '../../abis/ERC20Factory.json' with { type: 'json' }
import HyperlaneOracleAbiJson from '../../abis/HyperlaneOracle.json' with { type: 'json' }
import ICOPresaleAbiJson from '../../abis/ICOPresale.json' with { type: 'json' }
import IdentityRegistryAbiJson from '../../abis/IdentityRegistry.json' with { type: 'json' }
import InputSettlerAbiJson from '../../abis/InputSettler.json' with { type: 'json' }
import LaunchpadTokenAbiJson from '../../abis/LaunchpadToken.json' with { type: 'json' }
import LiquidityVaultAbiJson from '../../abis/LiquidityVault.json' with { type: 'json' }
import LPLockerAbiJson from '../../abis/LPLocker.json' with { type: 'json' }
import ModerationMarketplaceAbiJson from '../../abis/ModerationMarketplace.json' with { type: 'json' }
import MultiTokenPaymasterAbiJson from '../../abis/MultiTokenPaymaster.json' with { type: 'json' }
import NetworkTokenAbiJson from '../../abis/NetworkToken.json' with { type: 'json' }
import OracleRouterAbiJson from '../../abis/OracleRouter.json' with { type: 'json' }
import OutputSettlerAbiJson from '../../abis/OutputSettler.json' with { type: 'json' }
import PaymasterFactoryAbiJson from '../../abis/PaymasterFactory.json' with { type: 'json' }
import PlayerTradeEscrowAbiJson from '../../abis/PlayerTradeEscrow.json' with { type: 'json' }
import ReputationRegistryAbiJson from '../../abis/ReputationRegistry.json' with { type: 'json' }
import SimpleOracleAbiJson from '../../abis/SimpleOracle.json' with { type: 'json' }
import SolverRegistryAbiJson from '../../abis/SolverRegistry.json' with { type: 'json' }
import SponsoredPaymasterAbiJson from '../../abis/SponsoredPaymaster.json' with { type: 'json' }
import SuperchainOracleAbiJson from '../../abis/SuperchainOracle.json' with { type: 'json' }
import TokenLaunchpadAbiJson from '../../abis/TokenLaunchpad.json' with { type: 'json' }
import TokenRegistryAbiJson from '../../abis/TokenRegistry.json' with { type: 'json' }
import ValidationRegistryAbiJson from '../../abis/ValidationRegistry.json' with { type: 'json' }
import VRFCoordinatorV2_5AbiJson from '../../abis/VRFCoordinatorV2_5.json' with { type: 'json' }

// Legacy PascalCase exports (cast to Abi, loses type inference)
// @deprecated Use camelCase typed exports from '../generated' instead
export const ERC20Abi = ERC20AbiJson.abi as Abi
export const ERC20FactoryAbi = ERC20FactoryAbiJson.abi as Abi
export const BazaarAbi = BazaarAbiJson.abi as Abi
export const IdentityRegistryAbi = IdentityRegistryAbiJson.abi as Abi
export const ReputationRegistryAbi = ReputationRegistryAbiJson.abi as Abi
export const ValidationRegistryAbi = ValidationRegistryAbiJson.abi as Abi
export const InputSettlerAbi = InputSettlerAbiJson.abi as Abi
export const OutputSettlerAbi = OutputSettlerAbiJson.abi as Abi
export const SolverRegistryAbi = SolverRegistryAbiJson.abi as Abi
export const SimpleOracleAbi = SimpleOracleAbiJson.abi as Abi
export const HyperlaneOracleAbi = HyperlaneOracleAbiJson.abi as Abi
export const SuperchainOracleAbi = SuperchainOracleAbiJson.abi as Abi
export const BanManagerAbi = BanManagerAbiJson.abi as Abi
export const ModerationMarketplaceAbi = ModerationMarketplaceAbiJson.abi as Abi
export const NetworkTokenAbi = NetworkTokenAbiJson.abi as Abi
export const CreditManagerAbi = CreditManagerAbiJson.abi as Abi
export const MultiTokenPaymasterAbi = MultiTokenPaymasterAbiJson.abi as Abi
export const TokenRegistryAbi = TokenRegistryAbiJson.abi as Abi
export const PaymasterFactoryAbi = PaymasterFactoryAbiJson.abi as Abi
export const LiquidityVaultAbi = LiquidityVaultAbiJson.abi as Abi
export const AppTokenPreferenceAbi = AppTokenPreferenceAbiJson.abi as Abi
export const PlayerTradeEscrowAbi = PlayerTradeEscrowAbiJson.abi as Abi
export const SponsoredPaymasterAbi = SponsoredPaymasterAbiJson.abi as Abi
export const TokenLaunchpadAbi = TokenLaunchpadAbiJson.abi as Abi
export const BondingCurveAbi = BondingCurveAbiJson.abi as Abi
export const ICOPresaleAbi = ICOPresaleAbiJson.abi as Abi
export const LPLockerAbi = LPLockerAbiJson.abi as Abi
export const LaunchpadTokenAbi = LaunchpadTokenAbiJson.abi as Abi
export const VRFCoordinatorV2_5Abi = VRFCoordinatorV2_5AbiJson.abi as Abi
export const AutomationRegistryAbi = AutomationRegistryAbiJson.abi as Abi
export const OracleRouterAbi = OracleRouterAbiJson.abi as Abi
export const ChainlinkGovernanceAbi = ChainlinkGovernanceAbiJson.abi as Abi

// Export raw JSON files
export {
  ERC20AbiJson,
  ERC20FactoryAbiJson,
  BazaarAbiJson,
  IdentityRegistryAbiJson,
  ReputationRegistryAbiJson,
  ValidationRegistryAbiJson,
  InputSettlerAbiJson,
  OutputSettlerAbiJson,
  SolverRegistryAbiJson,
  SimpleOracleAbiJson,
  HyperlaneOracleAbiJson,
  SuperchainOracleAbiJson,
  BanManagerAbiJson,
  ModerationMarketplaceAbiJson,
  NetworkTokenAbiJson,
  CreditManagerAbiJson,
  MultiTokenPaymasterAbiJson,
  TokenRegistryAbiJson,
  PaymasterFactoryAbiJson,
  LiquidityVaultAbiJson,
  AppTokenPreferenceAbiJson,
  PlayerTradeEscrowAbiJson,
  SponsoredPaymasterAbiJson,
  TokenLaunchpadAbiJson,
  BondingCurveAbiJson,
  ICOPresaleAbiJson,
  LPLockerAbiJson,
  LaunchpadTokenAbiJson,
  VRFCoordinatorV2_5AbiJson,
  AutomationRegistryAbiJson,
  OracleRouterAbiJson,
  ChainlinkGovernanceAbiJson,
}

// ============================================================================
// TYPED ABI FRAGMENTS - Common patterns with full type inference
// ============================================================================

/** Standard ERC20 read functions with full type inference */
export const ERC20ReadAbi = [
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Standard ERC20 write functions with full type inference */
export const ERC20WriteAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const
