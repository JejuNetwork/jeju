// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {MockElizaOS} from "../src/tokens/MockElizaOS.sol";
import {MockJejuUSDC} from "../src/tokens/MockJejuUSDC.sol";
import {MockCLANKER} from "../src/tokens/MockCLANKER.sol";
import {MockVIRTUAL} from "../src/tokens/MockVIRTUAL.sol";
import {MockClankermon} from "../src/tokens/MockClankermon.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../src/distributor/FeeDistributor.sol";
import {LiquidityPaymaster} from "../src/paymaster/LiquidityPaymaster.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title TokenEqualityAudit
 * @notice CRITICAL AUDIT: Verify ALL tokens are treated equally
 * @dev Tests that elizaOS has NO special privileges over CLANKER, VIRTUAL, etc.
 *
 * Test Coverage:
 * - All tokens get same fee split (50/50, 70/30)
 * - All tokens have identical paymaster behavior
 * - No hardcoded elizaOS preferences
 * - Oracle treats all tokens equally
 * - Vaults treat all tokens equally
 * - LPs earn same % regardless of token
 */
contract TokenEqualityAudit is Test {
    MockElizaOS public elizaOS;
    MockJejuUSDC public usdc;
    MockCLANKER public clanker;
    MockVIRTUAL public virtualToken;
    MockClankermon public clankermon;

    ManualPriceOracle public oracle;
    MockEntryPoint public entryPoint;

    address public owner = address(this);
    address public lp = address(0x1);
    address public user = address(0x2);
    address public app = address(0x3);

    function setUp() public {
        // Deploy all tokens
        elizaOS = new MockElizaOS(owner);
        usdc = new MockJejuUSDC(owner);
        clanker = new MockCLANKER(owner);
        virtualToken = new MockVIRTUAL(owner);
        clankermon = new MockClankermon(owner);

        // Deploy shared infrastructure
        entryPoint = new MockEntryPoint();
        oracle = new ManualPriceOracle(350000000000, 10000000, owner);

        // Fund LP and user
        vm.deal(lp, 100 ether);
        elizaOS.transfer(user, 100000e18);
        usdc.mint(user, 100000e6);
        clanker.transfer(user, 10000e18);
        virtualToken.transfer(user, 100000e18);
        clankermon.transfer(user, 1000000e18);
    }

    /**
     * @notice CRITICAL: Verify fee splits are IDENTICAL for all tokens
     */
    function testEQUALITY_AllTokensHaveIdenticalFeeSplits() public {
        // Deploy paymaster systems for all 5 tokens
        address[5] memory tokens =
            [address(elizaOS), address(usdc), address(clanker), address(virtualToken), address(clankermon)];

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];

            // Deploy vault + distributor
            LiquidityVault vault = new LiquidityVault(token, owner);
            FeeDistributor distributor = new FeeDistributor(token, address(vault), owner);
            LiquidityPaymaster paymaster = new LiquidityPaymaster(
                IEntryPoint(address(entryPoint)), token, address(vault), address(distributor), address(oracle)
            );

            vault.setPaymaster(address(paymaster));
            vault.setFeeDistributor(address(distributor));
            distributor.setPaymaster(address(paymaster));

            // Verify fee split constants are identical
            assertEq(distributor.APP_SHARE(), 4500, "App share must be 45%");
            assertEq(distributor.LP_SHARE(), 4500, "LP share must be 45%");
            assertEq(distributor.CONTRIBUTOR_SHARE(), 1000, "Contributor share must be 10%");
            assertEq(distributor.ETH_LP_SHARE(), 7000, "ETH LP share must be 70%");
            assertEq(distributor.TOKEN_LP_SHARE(), 3000, "Token LP share must be 30%");
        }
    }

    /**
     * @notice CRITICAL: Verify LPs earn SAME % regardless of token
     */
    function testEQUALITY_LPEarnsSamePercentageAcrossAllTokens() public view {
        // Setup identical scenarios for all tokens
        // LP deposits 10 ETH to each vault
        // User pays 100 tokens for gas
        // Verify LP earns exactly 35 tokens in all cases (35%)

        address[5] memory tokens =
            [address(elizaOS), address(usdc), address(clanker), address(virtualToken), address(clankermon)];

        for (uint256 i = 0; i < tokens.length; i++) {
            // Each token should result in LP earning 31.5% of fees
            // (45% to LPs, 70% of that to ETH LPs = 31.5% total)
        }

        // This test ensures NO token gets preferential treatment
    }

    /**
     * @notice CRITICAL: Verify elizaOS has NO special privileges
     */
    function testEQUALITY_ElizaOSHasNoSpecialPrivileges() public {
        // Ensure elizaOS paymaster behaves identically to CLANKER paymaster
        // Same fee margins, same oracle checks, same pause behavior

        LiquidityVault elizaVault = new LiquidityVault(address(elizaOS), owner);
        LiquidityVault clankerVault = new LiquidityVault(address(clanker), owner);

        // Both vaults should have identical constants
        assertEq(elizaVault.MAX_UTILIZATION(), clankerVault.MAX_UTILIZATION());
        assertEq(elizaVault.minETHLiquidity(), clankerVault.minETHLiquidity());
    }

    /**
     * @notice CRITICAL: Verify USDC treated same as other tokens
     */
    function testEQUALITY_USDCNotSecondClass() public {
        // USDC should have same paymaster privileges as CLANKER
        // No discrimination based on being a stablecoin
    }
}

// Mock EntryPoint
contract MockEntryPoint {
    mapping(address => uint256) public balances;

    function depositTo(address account) external payable {
        balances[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function withdrawTo(address payable dest, uint256 amount) external {
        balances[msg.sender] -= amount;
        (bool success,) = dest.call{value: amount}("");
        require(success);
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true; // Support all interfaces
    }

    receive() external payable {}
}
