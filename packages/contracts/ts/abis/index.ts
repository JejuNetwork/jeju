/**
 * @fileoverview Contract ABI exports
 * @module @jejunetwork/contracts/abis
 */

import type { Abi } from 'viem'
import AppTokenPreferenceAbiJson from '../../abis/AppTokenPreference.json'
import AutomationRegistryAbiJson from '../../abis/AutomationRegistry.json'
// Babylon Diamond ABIs (EIP-2535 Prediction Markets)
import BabylonDiamondAbiJson from '../../abis/BabylonDiamond.json'
import BabylonDiamondCutFacetAbiJson from '../../abis/BabylonDiamondCutFacet.json'
import BabylonDiamondLoupeFacetAbiJson from '../../abis/BabylonDiamondLoupeFacet.json'
import BabylonERC8004IdentityRegistryAbiJson from '../../abis/BabylonERC8004IdentityRegistry.json'
import BabylonERC8004ReputationSystemAbiJson from '../../abis/BabylonERC8004ReputationSystem.json'
import BabylonOracleFacetAbiJson from '../../abis/BabylonOracleFacet.json'
import BabylonPredictionMarketFacetAbiJson from '../../abis/BabylonPredictionMarketFacet.json'
// Moderation ABIs
import BanManagerAbiJson from '../../abis/BanManager.json'
import BazaarAbiJson from '../../abis/Bazaar.json'
import BondingCurveAbiJson from '../../abis/BondingCurve.json'
import ChainlinkGovernanceAbiJson from '../../abis/ChainlinkGovernance.json'
// Service ABIs
import CreditManagerAbiJson from '../../abis/CreditManager.json'
// Re-export ABIs with their types
import ERC20AbiJson from '../../abis/ERC20.json'
import ERC20FactoryAbiJson from '../../abis/ERC20Factory.json'
import GameIntegrationAbiJson from '../../abis/GameIntegration.json'
// Game ABIs (Hyperscape / forkable game contracts)
import GoldAbiJson from '../../abis/Gold.json'
import HyperlaneOracleAbiJson from '../../abis/HyperlaneOracle.json'
import ICOPresaleAbiJson from '../../abis/ICOPresale.json'
import IdentityRegistryAbiJson from '../../abis/IdentityRegistry.json'
// OIF (Open Intents Framework) ABIs
import InputSettlerAbiJson from '../../abis/InputSettler.json'
import ItemsAbiJson from '../../abis/Items.json'
import LaunchpadTokenAbiJson from '../../abis/LaunchpadToken.json'
import LiquidityVaultAbiJson from '../../abis/LiquidityVault.json'
import LPLockerAbiJson from '../../abis/LPLocker.json'
import ModerationMarketplaceAbiJson from '../../abis/ModerationMarketplace.json'
import MultiTokenPaymasterAbiJson from '../../abis/MultiTokenPaymaster.json'
// Native token ABI
import NetworkTokenAbiJson from '../../abis/NetworkToken.json'
import OracleRouterAbiJson from '../../abis/OracleRouter.json'
import OutputSettlerAbiJson from '../../abis/OutputSettler.json'
import PaymasterFactoryAbiJson from '../../abis/PaymasterFactory.json'
import PlayerTradeEscrowAbiJson from '../../abis/PlayerTradeEscrow.json'
import ReputationRegistryAbiJson from '../../abis/ReputationRegistry.json'
import SimpleOracleAbiJson from '../../abis/SimpleOracle.json'
import SolverRegistryAbiJson from '../../abis/SolverRegistry.json'
// Paymaster ABIs (ERC-4337 Account Abstraction)
import SponsoredPaymasterAbiJson from '../../abis/SponsoredPaymaster.json'
import SuperchainOracleAbiJson from '../../abis/SuperchainOracle.json'
// Launchpad ABIs
import TokenLaunchpadAbiJson from '../../abis/TokenLaunchpad.json'
// Paymaster System ABIs
import TokenRegistryAbiJson from '../../abis/TokenRegistry.json'
import ValidationRegistryAbiJson from '../../abis/ValidationRegistry.json'
// Chainlink ABIs
import VRFCoordinatorV2_5AbiJson from '../../abis/VRFCoordinatorV2_5.json'

// Extract and type the ABIs
export const ERC20Abi = ERC20AbiJson.abi as Abi
export const ERC20FactoryAbi = ERC20FactoryAbiJson.abi as Abi
export const BazaarAbi = BazaarAbiJson.abi as Abi
export const IdentityRegistryAbi = IdentityRegistryAbiJson.abi as Abi
export const ReputationRegistryAbi = ReputationRegistryAbiJson.abi as Abi
export const ValidationRegistryAbi = ValidationRegistryAbiJson.abi as Abi

// Babylon Diamond ABIs (EIP-2535 Prediction Markets)
export const BabylonDiamondAbi = BabylonDiamondAbiJson.abi as Abi
export const BabylonDiamondCutFacetAbi = BabylonDiamondCutFacetAbiJson.abi as Abi
export const BabylonDiamondLoupeFacetAbi = BabylonDiamondLoupeFacetAbiJson.abi as Abi
export const BabylonPredictionMarketFacetAbi = BabylonPredictionMarketFacetAbiJson.abi as Abi
export const BabylonOracleFacetAbi = BabylonOracleFacetAbiJson.abi as Abi
export const BabylonERC8004IdentityRegistryAbi = BabylonERC8004IdentityRegistryAbiJson.abi as Abi
export const BabylonERC8004ReputationSystemAbi = BabylonERC8004ReputationSystemAbiJson.abi as Abi

// OIF ABIs
export const InputSettlerAbi = InputSettlerAbiJson.abi as Abi
export const OutputSettlerAbi = OutputSettlerAbiJson.abi as Abi
export const SolverRegistryAbi = SolverRegistryAbiJson.abi as Abi
export const SimpleOracleAbi = SimpleOracleAbiJson.abi as Abi
export const HyperlaneOracleAbi = HyperlaneOracleAbiJson.abi as Abi
export const SuperchainOracleAbi = SuperchainOracleAbiJson.abi as Abi

// Moderation ABIs
export const BanManagerAbi = BanManagerAbiJson.abi as Abi
export const ModerationMarketplaceAbi = ModerationMarketplaceAbiJson.abi as Abi

// Native token ABI
export const NetworkTokenAbi = NetworkTokenAbiJson.abi as Abi

// Service ABIs
export const CreditManagerAbi = CreditManagerAbiJson.abi as Abi
export const MultiTokenPaymasterAbi = MultiTokenPaymasterAbiJson.abi as Abi

// Paymaster System ABIs
export const TokenRegistryAbi = TokenRegistryAbiJson.abi as Abi
export const PaymasterFactoryAbi = PaymasterFactoryAbiJson.abi as Abi
export const LiquidityVaultAbi = LiquidityVaultAbiJson.abi as Abi
export const AppTokenPreferenceAbi = AppTokenPreferenceAbiJson.abi as Abi

// Game ABIs (Hyperscape / forkable game infrastructure)
export const GoldAbi = GoldAbiJson.abi as Abi
export const ItemsAbi = ItemsAbiJson.abi as Abi
export const GameIntegrationAbi = GameIntegrationAbiJson.abi as Abi
export const PlayerTradeEscrowAbi = PlayerTradeEscrowAbiJson.abi as Abi

// Paymaster ABIs (ERC-4337 Account Abstraction)
export const SponsoredPaymasterAbi = SponsoredPaymasterAbiJson.abi as Abi

// Launchpad ABIs
export const TokenLaunchpadAbi = TokenLaunchpadAbiJson.abi as Abi
export const BondingCurveAbi = BondingCurveAbiJson.abi as Abi
export const ICOPresaleAbi = ICOPresaleAbiJson.abi as Abi
export const LPLockerAbi = LPLockerAbiJson.abi as Abi
export const LaunchpadTokenAbi = LaunchpadTokenAbiJson.abi as Abi

// Chainlink ABIs
export const VRFCoordinatorV2_5Abi = VRFCoordinatorV2_5AbiJson as Abi
export const AutomationRegistryAbi = AutomationRegistryAbiJson as Abi
export const OracleRouterAbi = OracleRouterAbiJson as Abi
export const ChainlinkGovernanceAbi = ChainlinkGovernanceAbiJson as Abi

// Export the full JSON files for those who need address + abi
export {
  ERC20AbiJson,
  ERC20FactoryAbiJson,
  BazaarAbiJson,
  IdentityRegistryAbiJson,
  ReputationRegistryAbiJson,
  ValidationRegistryAbiJson,
}
export { InputSettlerAbiJson, OutputSettlerAbiJson, SolverRegistryAbiJson }
export { SimpleOracleAbiJson, HyperlaneOracleAbiJson, SuperchainOracleAbiJson }
export { BanManagerAbiJson, ModerationMarketplaceAbiJson }
export { NetworkTokenAbiJson }
export { CreditManagerAbiJson, MultiTokenPaymasterAbiJson }
export {
  TokenRegistryAbiJson,
  PaymasterFactoryAbiJson,
  LiquidityVaultAbiJson,
  AppTokenPreferenceAbiJson,
}
export {
  GoldAbiJson,
  ItemsAbiJson,
  GameIntegrationAbiJson,
  PlayerTradeEscrowAbiJson,
}
export { SponsoredPaymasterAbiJson }
export {
  TokenLaunchpadAbiJson,
  BondingCurveAbiJson,
  ICOPresaleAbiJson,
  LPLockerAbiJson,
  LaunchpadTokenAbiJson,
}
export {
  VRFCoordinatorV2_5AbiJson,
  AutomationRegistryAbiJson,
  OracleRouterAbiJson,
  ChainlinkGovernanceAbiJson,
}

// Babylon Diamond ABIs (EIP-2535 Prediction Markets)
export {
  BabylonDiamondAbiJson,
  BabylonDiamondCutFacetAbiJson,
  BabylonDiamondLoupeFacetAbiJson,
  BabylonPredictionMarketFacetAbiJson,
  BabylonOracleFacetAbiJson,
  BabylonERC8004IdentityRegistryAbiJson,
  BabylonERC8004ReputationSystemAbiJson,
}

// Common ABI fragments for convenience
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
