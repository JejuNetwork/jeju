/**
 * @fileoverview Contract ABI exports
 * @module @jejunetwork/contracts/abis
 */

// Re-export ABIs with their types
import ERC20AbiJson from '../../abis/ERC20.json';
import ERC20FactoryAbiJson from '../../abis/ERC20Factory.json';
import BazaarAbiJson from '../../abis/Bazaar.json';
import IdentityRegistryAbiJson from '../../abis/IdentityRegistry.json';

// OIF (Open Intents Framework) ABIs
import InputSettlerAbiJson from '../../abis/InputSettler.json';
import OutputSettlerAbiJson from '../../abis/OutputSettler.json';
import SolverRegistryAbiJson from '../../abis/SolverRegistry.json';
import SimpleOracleAbiJson from '../../abis/SimpleOracle.json';
import HyperlaneOracleAbiJson from '../../abis/HyperlaneOracle.json';
import SuperchainOracleAbiJson from '../../abis/SuperchainOracle.json';

// OTC ABIs
import OTCAbiJson from '../../abis/OTC.json';
import SimplePoolOracleAbiJson from '../../abis/SimplePoolOracle.json';
import RegistrationHelperAbiJson from '../../abis/RegistrationHelper.json';
import MockERC20AbiJson from '../../abis/MockERC20.json';
import MockAggregatorV3AbiJson from '../../abis/MockAggregatorV3.json';

// Moderation ABIs
import BanManagerAbiJson from '../../abis/BanManager.json';
import ModerationMarketplaceAbiJson from '../../abis/ModerationMarketplace.json';

// Native token ABI
import JejuTokenAbiJson from '../../abis/JejuToken.json';

// Service ABIs
import CreditManagerAbiJson from '../../abis/CreditManager.json';
import MultiTokenPaymasterAbiJson from '../../abis/MultiTokenPaymaster.json';

// Paymaster System ABIs
import TokenRegistryAbiJson from '../../abis/TokenRegistry.json';
import PaymasterFactoryAbiJson from '../../abis/PaymasterFactory.json';
import LiquidityVaultAbiJson from '../../abis/LiquidityVault.json';
import AppTokenPreferenceAbiJson from '../../abis/AppTokenPreference.json';

// Game ABIs (Hyperscape / forkable game contracts)
import GoldAbiJson from '../../abis/Gold.json';
import ItemsAbiJson from '../../abis/Items.json';
import GameIntegrationAbiJson from '../../abis/GameIntegration.json';
import PlayerTradeEscrowAbiJson from '../../abis/PlayerTradeEscrow.json';

// Paymaster ABIs (ERC-4337 Account Abstraction)
import SponsoredPaymasterAbiJson from '../../abis/SponsoredPaymaster.json';

import type { Abi } from 'viem';

// Extract and type the ABIs
export const ERC20Abi = ERC20AbiJson.abi as Abi;
export const ERC20FactoryAbi = ERC20FactoryAbiJson.abi as Abi;
export const BazaarAbi = BazaarAbiJson.abi as Abi;
export const IdentityRegistryAbi = IdentityRegistryAbiJson.abi as Abi;

// OIF ABIs
export const InputSettlerAbi = InputSettlerAbiJson.abi as Abi;
export const OutputSettlerAbi = OutputSettlerAbiJson.abi as Abi;
export const SolverRegistryAbi = SolverRegistryAbiJson.abi as Abi;
export const SimpleOracleAbi = SimpleOracleAbiJson.abi as Abi;
export const HyperlaneOracleAbi = HyperlaneOracleAbiJson.abi as Abi;
export const SuperchainOracleAbi = SuperchainOracleAbiJson.abi as Abi;

// OTC ABIs
export const OTCAbi = OTCAbiJson.abi as Abi;
export const SimplePoolOracleAbi = SimplePoolOracleAbiJson.abi as Abi;
export const RegistrationHelperAbi = RegistrationHelperAbiJson.abi as Abi;
export const MockERC20Abi = MockERC20AbiJson.abi as Abi;
export const MockAggregatorV3Abi = MockAggregatorV3AbiJson.abi as Abi;

// Moderation ABIs
export const BanManagerAbi = BanManagerAbiJson.abi as Abi;
export const ModerationMarketplaceAbi = ModerationMarketplaceAbiJson.abi as Abi;

// Native token ABI
export const JejuTokenAbi = JejuTokenAbiJson.abi as Abi;

// Service ABIs
export const CreditManagerAbi = CreditManagerAbiJson.abi as Abi;
export const MultiTokenPaymasterAbi = MultiTokenPaymasterAbiJson.abi as Abi;

// Paymaster System ABIs
export const TokenRegistryAbi = TokenRegistryAbiJson.abi as Abi;
export const PaymasterFactoryAbi = PaymasterFactoryAbiJson.abi as Abi;
export const LiquidityVaultAbi = LiquidityVaultAbiJson.abi as Abi;
export const AppTokenPreferenceAbi = AppTokenPreferenceAbiJson.abi as Abi;

// Game ABIs (Hyperscape / forkable game infrastructure)
// Note: Games use the standard Jeju BanManager for moderation (see moderation/BanManager.sol)
export const GoldAbi = GoldAbiJson.abi as Abi;
export const ItemsAbi = ItemsAbiJson.abi as Abi;
export const GameIntegrationAbi = GameIntegrationAbiJson.abi as Abi;
export const PlayerTradeEscrowAbi = PlayerTradeEscrowAbiJson.abi as Abi;

// Paymaster ABIs (ERC-4337 Account Abstraction)
export const SponsoredPaymasterAbi = SponsoredPaymasterAbiJson.abi as Abi;

// Export the full JSON files for those who need address + abi
export { ERC20AbiJson, ERC20FactoryAbiJson, BazaarAbiJson, IdentityRegistryAbiJson };
export { InputSettlerAbiJson, OutputSettlerAbiJson, SolverRegistryAbiJson };
export { SimpleOracleAbiJson, HyperlaneOracleAbiJson, SuperchainOracleAbiJson };
export { OTCAbiJson, SimplePoolOracleAbiJson, RegistrationHelperAbiJson, MockERC20AbiJson, MockAggregatorV3AbiJson };
export { BanManagerAbiJson, ModerationMarketplaceAbiJson };
export { JejuTokenAbiJson };
export { CreditManagerAbiJson, MultiTokenPaymasterAbiJson };
export { TokenRegistryAbiJson, PaymasterFactoryAbiJson, LiquidityVaultAbiJson, AppTokenPreferenceAbiJson };
export { GoldAbiJson, ItemsAbiJson, GameIntegrationAbiJson, PlayerTradeEscrowAbiJson };
export { SponsoredPaymasterAbiJson };

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
] as const;

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
] as const;

