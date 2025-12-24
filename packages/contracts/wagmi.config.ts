import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

/**
 * Wagmi CLI Configuration for Typed Contract Generation
 *
 * Generates TypeScript with `as const` assertions from forge artifacts,
 * enabling full type inference in viem:
 * - Function name autocomplete
 * - Argument type inference
 * - Return type inference
 * - Event type inference
 *
 * Usage:
 *   bun wagmi generate
 */
export default defineConfig({
  out: 'ts/generated.ts',
  plugins: [
    foundry({
      project: '.',
      include: [
        // Identity & Moderation
        'IdentityRegistry.sol/IdentityRegistry.json',
        'ReputationRegistry.sol/ReputationRegistry.json',
        'ValidationRegistry.sol/ValidationRegistry.json',
        'BanManager.sol/BanManager.json',
        'ModerationMarketplace.sol/ModerationMarketplace.json',

        // OIF (Open Intents Framework)
        'InputSettler.sol/InputSettler.json',
        'OutputSettler.sol/OutputSettler.json',
        'SolverRegistry.sol/SolverRegistry.json',
        'HyperlaneOracle.sol/HyperlaneOracle.json',
        'OracleRegistry.sol/OracleRegistry.json',

        // Federation
        'FederatedIdentity.sol/FederatedIdentity.json',
        'FederatedLiquidity.sol/FederatedLiquidity.json',
        'FederatedSolver.sol/FederatedSolver.json',

        // Service Contracts
        'CreditManager.sol/CreditManager.json',
        'MultiTokenPaymaster.sol/MultiTokenPaymaster.json',

        // Paymaster System
        'TokenRegistry.sol/TokenRegistry.json',
        'PaymasterFactory.sol/PaymasterFactory.json',
        'LiquidityVault.sol/LiquidityVault.json',
        'LiquidityPaymaster.sol/LiquidityPaymaster.json',

        // Launchpad
        'TokenLaunchpad.sol/TokenLaunchpad.json',
        'BondingCurve.sol/BondingCurve.json',
        'ICOPresale.sol/ICOPresale.json',
        'LPLocker.sol/LPLocker.json',
        'LaunchpadToken.sol/LaunchpadToken.json',

        // Chainlink
        'AutomationRegistry.sol/AutomationRegistry.json',
        'OracleRouter.sol/OracleRouter.json',
        'ChainlinkGovernance.sol/ChainlinkGovernance.json',
        'VRFCoordinatorV2_5.sol/VRFCoordinatorV2_5.json',

        // Registry
        'NetworkRegistry.sol/NetworkRegistry.json',
        'UserBlockRegistry.sol/UserBlockRegistry.json',
        'RegistrationHelper.sol/RegistrationHelper.json',

        // OTC / Trading
        'OTC.sol/OTC.json',
        'SimplePoolOracle.sol/SimplePoolOracle.json',

        // Core tokens (use MockERC20 for testing, ERC20 has duplicates from OpenZeppelin)
        'MockERC20.sol/MockERC20.json',

        // Funding
        'ContributorRegistry.sol/ContributorRegistry.json',
        'PaymentRequestRegistry.sol/PaymentRequestRegistry.json',
        'WorkAgreementRegistry.sol/WorkAgreementRegistry.json',
        'DeepFundingDistributor.sol/DeepFundingDistributor.json',

        // Work
        'BountyRegistry.sol/BountyRegistry.json',

        // Governance
        'DAORegistry.sol/DAORegistry.json',

        // Prediction Markets
        'PredictionMarket.sol/PredictionMarket.json',

        // Fee Config
        'FeeConfig.sol/FeeConfig.json',
      ],
      exclude: [
        'Common.sol/**',
        'Components.sol/**',
        'Script.sol/**',
        'StdAssertions.sol/**',
        'StdInvariant.sol/**',
        'StdError.sol/**',
        'StdCheats.sol/**',
        'StdMath.sol/**',
        'StdJson.sol/**',
        'StdStorage.sol/**',
        'StdUtils.sol/**',
        'Vm.sol/**',
        'console.sol/**',
        'console2.sol/**',
        'test.sol/**',
        '**.s.sol/*.json',
        '**.t.sol/*.json',
      ],
      forge: {
        build: false,
        clean: false,
      },
    }),
  ],
})
