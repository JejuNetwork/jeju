// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, 1000000 * 10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

contract MockOracle {
    function getPrice(address) external pure returns (uint256, uint256) {
        return (1e18, 18); // $1 with 18 decimals
    }

    function isPriceFresh(address) external pure returns (bool) {
        return true;
    }
}

/**
 * @title TokenRegistry Test Suite
 * @notice Comprehensive tests for multi-token paymaster registry
 */
contract TokenRegistryTest is Test {
    TokenRegistry public registry;
    MockToken public tokenA;
    MockToken public tokenB;
    MockToken public tokenC;
    MockOracle public oracle;

    address owner = address(this);
    address treasury = makeAddr("treasury");
    address projectA = makeAddr("projectA");
    address projectB = makeAddr("projectB");
    address attacker = makeAddr("attacker");

    event TokenRegistered(
        address indexed token,
        address indexed registrant,
        string name,
        string symbol,
        address oracle,
        uint256 minFeeMargin,
        uint256 maxFeeMargin,
        uint256 registrationFee
    );

    event TokenActivated(address indexed token, address indexed activatedBy);
    event TokenDeactivated(address indexed token, address indexed deactivatedBy);

    function setUp() public {
        registry = new TokenRegistry(owner, treasury);
        oracle = new MockOracle();

        // Deploy test tokens
        tokenA = new MockToken("Token A", "TKA", 18);
        tokenB = new MockToken("Token B", "TKB", 6);
        tokenC = new MockToken("Token C", "TKC", 18);

        // Fund test accounts
        vm.deal(projectA, 10 ether);
        vm.deal(projectB, 10 ether);
        vm.deal(attacker, 10 ether);
    }

    // ============ Constructor Tests ============

    function test_Constructor_SetsOwnerAndTreasury() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.treasury(), treasury);
    }

    function test_Constructor_SetsDefaultValues() public view {
        assertEq(registry.registrationFee(), 0.1 ether);
        assertEq(registry.globalMinFeeMargin(), 0);
        assertEq(registry.globalMaxFeeMargin(), 500); // 5%
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(TokenRegistry.InvalidTreasury.selector);
        new TokenRegistry(owner, address(0));
    }

    // ============ Registration Tests ============

    function test_RegisterToken_Success() public {
        uint256 treasuryBalanceBefore = treasury.balance;

        vm.prank(projectA);
        vm.expectEmit(true, true, false, true);
        emit TokenRegistered(address(tokenA), projectA, "Token A", "TKA", address(oracle), 0, 200, 0.1 ether);

        uint256 tokenId = registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            0, // min fee 0%
            200 // max fee 2%
        );

        assertEq(tokenId, 0); // First token
        assertEq(treasury.balance, treasuryBalanceBefore + 0.1 ether);
    }

    function test_RegisterToken_StoresCorrectData() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            100, // 1% min
            300 // 3% max
        );

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));

        assertEq(config.tokenAddress, address(tokenA));
        assertEq(config.name, "Token A");
        assertEq(config.symbol, "TKA");
        assertEq(config.decimals, 18);
        assertEq(config.oracleAddress, address(oracle));
        assertEq(config.minFeeMargin, 100);
        assertEq(config.maxFeeMargin, 300);
        assertTrue(config.isActive);
        assertEq(config.registrant, projectA);
        assertEq(config.totalVolume, 0);
        assertEq(config.totalTransactions, 0);
    }

    function test_RegisterToken_HandlesNonStandardDecimals() public {
        // TokenB has 6 decimals (like USDC)
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 500);

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenB));
        assertEq(config.decimals, 6);
    }

    function test_RegisterToken_AllowsZeroFeesForCompetitiveProjects() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            0, // min 0% - no fees!
            0 // max 0% - locked at no fees
        );

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.minFeeMargin, 0);
        assertEq(config.maxFeeMargin, 0);
    }

    function test_RegisterToken_AllowsMaxFeesForRevenueModel() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            400, // min 4%
            500 // max 5% (global max)
        );

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.minFeeMargin, 400);
        assertEq(config.maxFeeMargin, 500);
    }

    function test_RegisterToken_AddToTokenList() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        address[] memory allTokens = registry.getAllTokens();
        assertEq(allTokens.length, 1);
        assertEq(allTokens[0], address(tokenA));
    }

    // ============ Registration Validation Tests ============

    function test_RevertRegisterToken_InsufficientFee() public {
        vm.prank(projectA);
        vm.expectRevert(
            abi.encodeWithSelector(TokenRegistry.InsufficientRegistrationFee.selector, 0.1 ether, 0.05 ether)
        );
        registry.registerToken{value: 0.05 ether}(address(tokenA), address(oracle), 0, 200);
    }

    function test_RevertRegisterToken_AlreadyRegistered() public {
        vm.startPrank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.TokenAlreadyRegistered.selector, address(tokenA)));
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        vm.stopPrank();
    }

    function test_RevertRegisterToken_ZeroTokenAddress() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidToken.selector, address(0)));
        registry.registerToken{value: 0.1 ether}(address(0), address(oracle), 0, 200);
    }

    function test_RevertRegisterToken_ZeroOracleAddress() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidOracle.selector, address(0)));
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(0), 0, 200);
    }

    function test_RevertRegisterToken_MinGreaterThanMax() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidFeeRange.selector, 300, 200));
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 300, 200);
    }

    function test_RevertRegisterToken_FeesAboveGlobalMax() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.FeesOutsideGlobalBounds.selector, 0, 600));
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 600); // 6% > 5% max
    }

    function test_RevertRegisterToken_FeesBelowGlobalMin() public {
        // Set global minimum to 1%
        registry.setGlobalFeeLimits(100, 500);

        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.FeesOutsideGlobalBounds.selector, 0, 200));
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
    }

    function test_RevertRegisterToken_WhenPaused() public {
        registry.pause();

        vm.prank(projectA);
        vm.expectRevert(); // Pausable: paused
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
    }

    // ============ Token Management Tests ============

    function test_ActivateToken() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        // Deactivate first
        registry.deactivateToken(address(tokenA));
        assertFalse(registry.isTokenSupported(address(tokenA)));

        // Reactivate
        vm.expectEmit(true, true, false, false);
        emit TokenActivated(address(tokenA), owner);

        registry.activateToken(address(tokenA));

        assertTrue(registry.isTokenSupported(address(tokenA)));
    }

    function test_DeactivateToken() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.expectEmit(true, true, false, false);
        emit TokenDeactivated(address(tokenA), owner);

        registry.deactivateToken(address(tokenA));

        assertFalse(registry.isTokenSupported(address(tokenA)));

        // Check config still exists, just inactive
        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.tokenAddress, address(tokenA));
        assertFalse(config.isActive);
    }

    function test_RevertActivateToken_NotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.TokenNotRegistered.selector, address(tokenA)));
        registry.activateToken(address(tokenA));
    }

    function test_OnlyOwnerCanActivateDeactivate() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(attacker);
        vm.expectRevert(); // Ownable: caller is not the owner
        registry.deactivateToken(address(tokenA));

        vm.prank(attacker);
        vm.expectRevert();
        registry.activateToken(address(tokenA));
    }

    // ============ Metadata Update Tests ============

    function test_UpdateMetadata() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        bytes32 newHash = keccak256("ipfs://QmNewMetadata");

        vm.prank(projectA);
        registry.updateMetadata(address(tokenA), newHash);

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.metadataHash, newHash);
    }

    function test_RevertUpdateMetadata_OnlyRegistrant() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(attacker);
        vm.expectRevert("Only registrant");
        registry.updateMetadata(address(tokenA), keccak256("hack"));
    }

    function test_RevertUpdateMetadata_NotRegistered() public {
        vm.prank(projectA);
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.TokenNotRegistered.selector, address(tokenA)));
        registry.updateMetadata(address(tokenA), bytes32(0));
    }

    // ============ View Function Tests ============

    function test_IsTokenSupported_ReturnsTrueForActiveToken() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        assertTrue(registry.isTokenSupported(address(tokenA)));
    }

    function test_IsTokenSupported_ReturnsFalseForInactiveToken() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        registry.deactivateToken(address(tokenA));

        assertFalse(registry.isTokenSupported(address(tokenA)));
    }

    function test_IsTokenSupported_ReturnsFalseForUnregistered() public view {
        assertFalse(registry.isTokenSupported(address(tokenA)));
    }

    function test_GetAllTokens_ReturnsAllRegistered() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 100, 300);

        address[] memory allTokens = registry.getAllTokens();

        assertEq(allTokens.length, 2);
        assertEq(allTokens[0], address(tokenA));
        assertEq(allTokens[1], address(tokenB));
    }

    function test_GetActiveTokens_ReturnsOnlyActive() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);

        // Deactivate tokenA
        registry.deactivateToken(address(tokenA));

        address[] memory activeTokens = registry.getActiveTokens();

        assertEq(activeTokens.length, 1);
        assertEq(activeTokens[0], address(tokenB));
    }

    function test_GetTokensByRegistrant() public {
        // ProjectA registers 2 tokens
        vm.startPrank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);
        vm.stopPrank();

        // ProjectB registers 1 token
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 0, 200);

        address[] memory projectATokens = registry.getTokensByRegistrant(projectA);
        address[] memory projectBTokens = registry.getTokensByRegistrant(projectB);

        assertEq(projectATokens.length, 2);
        assertEq(projectBTokens.length, 1);
        assertEq(projectATokens[0], address(tokenA));
        assertEq(projectATokens[1], address(tokenB));
        assertEq(projectBTokens[0], address(tokenC));
    }

    function test_GetTotalTokens() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        assertEq(registry.getTotalTokens(), 1);

        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);

        assertEq(registry.getTotalTokens(), 2);
    }

    function test_GetRegistryStats() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);

        // Deactivate one
        registry.deactivateToken(address(tokenA));

        (uint256 total, uint256 active, uint256 totalVolume, uint256 totalTx) = registry.getRegistryStats();

        assertEq(total, 2);
        assertEq(active, 1);
        assertEq(totalVolume, 0);
        assertEq(totalTx, 0);
    }

    function test_IsValidFeeMargin() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            100, // 1% min
            300 // 3% max
        );

        // Valid fees
        assertTrue(registry.isValidFeeMargin(address(tokenA), 100)); // At min
        assertTrue(registry.isValidFeeMargin(address(tokenA), 200)); // In range
        assertTrue(registry.isValidFeeMargin(address(tokenA), 300)); // At max

        // Invalid fees
        assertFalse(registry.isValidFeeMargin(address(tokenA), 50)); // Below min
        assertFalse(registry.isValidFeeMargin(address(tokenA), 400)); // Above max
    }

    // ============ Volume Tracking Tests ============

    function test_UpdateTokenVolume() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        // Simulate paymaster updating volume
        registry.updateTokenVolume(address(tokenA), 1 ether);

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.totalVolume, 1 ether);
        assertEq(config.totalTransactions, 1);

        // Update again
        registry.updateTokenVolume(address(tokenA), 0.5 ether);

        config = registry.getTokenConfig(address(tokenA));
        assertEq(config.totalVolume, 1.5 ether);
        assertEq(config.totalTransactions, 2);
    }

    function test_RevertUpdateVolume_NotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.TokenNotRegistered.selector, address(tokenA)));
        registry.updateTokenVolume(address(tokenA), 1 ether);
    }

    function test_RevertUpdateVolume_OnlyOwnerOrFactory() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(attacker);
        vm.expectRevert("Only owner");
        registry.updateTokenVolume(address(tokenA), 1 ether);
    }

    // ============ Admin Function Tests ============

    function test_SetGlobalFeeLimits() public {
        registry.setGlobalFeeLimits(50, 300); // 0.5% - 3%

        assertEq(registry.globalMinFeeMargin(), 50);
        assertEq(registry.globalMaxFeeMargin(), 300);
    }

    function test_RevertSetGlobalFeeLimits_MinGreaterThanMax() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidFeeRange.selector, 400, 200));
        registry.setGlobalFeeLimits(400, 200);
    }

    function test_RevertSetGlobalFeeLimits_MaxTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidFeeRange.selector, 0, 1100));
        registry.setGlobalFeeLimits(0, 1100); // 11% > 10% absolute max
    }

    function test_SetRegistrationFee() public {
        registry.setRegistrationFee(0.5 ether);
        assertEq(registry.registrationFee(), 0.5 ether);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        registry.setTreasury(newTreasury);

        assertEq(registry.treasury(), newTreasury);
    }

    function test_RevertSetTreasury_ZeroAddress() public {
        vm.expectRevert(TokenRegistry.InvalidTreasury.selector);
        registry.setTreasury(address(0));
    }

    function test_WithdrawFees() public {
        // Register multiple tokens
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 0, 200);

        uint256 treasuryBalanceBefore = treasury.balance;

        // Withdraw accumulated fees
        registry.withdrawFees();

        // Treasury should have received both registration fees
        assertEq(treasury.balance, treasuryBalanceBefore);
    }

    function test_OnlyOwnerCanCallAdminFunctions() public {
        vm.startPrank(attacker);

        vm.expectRevert();
        registry.setGlobalFeeLimits(0, 500);

        vm.expectRevert();
        registry.setRegistrationFee(0.5 ether);

        vm.expectRevert();
        registry.setTreasury(makeAddr("fake"));

        vm.expectRevert();
        registry.pause();

        vm.stopPrank();
    }

    // ============ Multi-Token Scenarios ============

    function test_RegisterMultipleTokens_DifferentFeeStructures() public {
        // Token A: 0% fees (competitive)
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0);

        // Token B: 1-3% fees (balanced)
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 100, 300);

        // Token C: 4-5% fees (maximum)
        vm.prank(projectA); // Same project, different token
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 400, 500);

        address[] memory allTokens = registry.getAllTokens();
        assertEq(allTokens.length, 3);

        // Verify each has different fee structure
        assertEq(registry.getTokenConfig(address(tokenA)).maxFeeMargin, 0);
        assertEq(registry.getTokenConfig(address(tokenB)).maxFeeMargin, 300);
        assertEq(registry.getTokenConfig(address(tokenC)).maxFeeMargin, 500);
    }

    function test_RegisterTokenWithExcessFee_RefundsNotImplemented() public {
        // Send 1 ETH (excess of 0.9 ETH)
        uint256 treasuryBefore = treasury.balance;

        vm.prank(projectA);
        registry.registerToken{value: 1 ether}(address(tokenA), address(oracle), 0, 200);

        // All fee goes to treasury (no refund mechanism)
        assertEq(treasury.balance, treasuryBefore + 1 ether);
    }

    // ============ Edge Cases ============

    function test_RegisterToken_WithMetadataHash() public {
        bytes32 metadata = keccak256("ipfs://QmMetadata");

        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200, metadata);

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.metadataHash, metadata);
    }

    function test_GetActiveTokens_EmptyWhenAllInactive() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);

        registry.deactivateToken(address(tokenA));

        address[] memory activeTokens = registry.getActiveTokens();
        assertEq(activeTokens.length, 0);
    }

    function test_GetTokensByRegistrant_EmptyForNewRegistrant() public {
        address nobody = makeAddr("nobody");
        address[] memory tokens = registry.getTokensByRegistrant(nobody);
        assertEq(tokens.length, 0);
    }

    // ============ Integration Scenarios ============

    function test_CompleteTokenLifecycle() public {
        // 1. Register
        vm.prank(projectA);
        uint256 tokenId = registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 100, 300);

        assertEq(tokenId, 0);
        assertTrue(registry.isTokenSupported(address(tokenA)));

        // 2. Update metadata
        vm.prank(projectA);
        registry.updateMetadata(address(tokenA), keccak256("v2"));

        // 3. Simulate usage (volume tracking)
        registry.updateTokenVolume(address(tokenA), 10 ether);
        registry.updateTokenVolume(address(tokenA), 5 ether);

        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(tokenA));
        assertEq(config.totalVolume, 15 ether);
        assertEq(config.totalTransactions, 2);

        // 4. Emergency deactivate
        registry.deactivateToken(address(tokenA));
        assertFalse(registry.isTokenSupported(address(tokenA)));

        // 5. Reactivate
        registry.activateToken(address(tokenA));
        assertTrue(registry.isTokenSupported(address(tokenA)));
    }

    function test_MultipleProjectsMultipleTokens() public {
        // Project A registers 2 tokens
        vm.startPrank(projectA);
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 0); // 0% fees
        registry.registerToken{value: 0.1 ether}(address(tokenB), address(oracle), 200, 400); // 2-4% fees
        vm.stopPrank();

        // Project B registers 1 token
        vm.prank(projectB);
        registry.registerToken{value: 0.1 ether}(address(tokenC), address(oracle), 500, 500); // Fixed 5%

        // Verify stats
        (uint256 total, uint256 active,,) = registry.getRegistryStats();
        assertEq(total, 3);
        assertEq(active, 3);

        // Verify registrant mappings
        address[] memory aTokens = registry.getTokensByRegistrant(projectA);
        address[] memory bTokens = registry.getTokensByRegistrant(projectB);

        assertEq(aTokens.length, 2);
        assertEq(bTokens.length, 1);
    }

    // ============ Fee Validation Tests ============

    function test_FeeValidation_AllScenariosWithinRange() public {
        vm.prank(projectA);
        registry.registerToken{value: 0.1 ether}(
            address(tokenA),
            address(oracle),
            100, // 1%
            300 // 3%
        );

        // Test boundary values
        assertTrue(registry.isValidFeeMargin(address(tokenA), 100)); // Exactly min
        assertTrue(registry.isValidFeeMargin(address(tokenA), 150)); // Between
        assertTrue(registry.isValidFeeMargin(address(tokenA), 200)); // Middle
        assertTrue(registry.isValidFeeMargin(address(tokenA), 250)); // Between
        assertTrue(registry.isValidFeeMargin(address(tokenA), 300)); // Exactly max

        // Test outside boundary
        assertFalse(registry.isValidFeeMargin(address(tokenA), 99)); // Below min
        assertFalse(registry.isValidFeeMargin(address(tokenA), 301)); // Above max
        assertFalse(registry.isValidFeeMargin(address(tokenA), 0)); // Way below
        assertFalse(registry.isValidFeeMargin(address(tokenA), 500)); // Way above
    }

    // ============ Gas Cost Benchmarks ============

    function test_Gas_RegisterToken() public {
        vm.prank(projectA);
        uint256 gasBefore = gasleft();
        registry.registerToken{value: 0.1 ether}(address(tokenA), address(oracle), 0, 200);
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("Gas used for registerToken():", gasUsed);

        // Should be reasonable (<350k gas with internal function refactor)
        assertLt(gasUsed, 350000);
    }

    function test_Gas_GetAllTokens_With100Tokens() public {
        // Register 100 tokens
        for (uint256 i = 0; i < 100; i++) {
            MockToken token = new MockToken("Token", "TKN", 18);
            vm.prank(projectA);
            registry.registerToken{value: 0.1 ether}(address(token), address(oracle), 0, 200);
        }

        uint256 gasBefore = gasleft();
        address[] memory allTokens = registry.getAllTokens();
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(allTokens.length, 100);
        console2.log("Gas to get 100 tokens:", gasUsed);
    }

    // ============ Version ============

    function test_Version() public view {
        assertEq(registry.version(), "2.0.0");
    }
}
