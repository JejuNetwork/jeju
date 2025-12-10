// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {AppTokenPreference, TokenBalance} from "../src/paymaster/AppTokenPreference.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 1e18);
    }
}

/**
 * @title AppTokenPreference Test Suite
 * @notice Tests for app-level token preference system
 */
contract AppTokenPreferenceTest is Test {
    AppTokenPreference public preference;

    MockToken public hyperToken;
    MockToken public babylonToken;
    MockToken public usdcToken;

    address public owner = address(this);
    address public hyperscapeApp = address(0x1111);
    address public babylonApp = address(0x2222);
    address public user = address(0x3333);
    address public registrant = address(0x4444);

    event AppPreferenceSet(
        address indexed appAddress,
        address indexed preferredToken,
        string symbol,
        bool allowFallback,
        address registrant
    );

    event AppPreferenceUpdated(address indexed appAddress, address indexed newPreferredToken, string symbol);
    event AppPreferenceRemoved(address indexed appAddress);
    event FallbackTokensSet(address indexed appAddress, address[] tokens);
    event GlobalDefaultsSet(address[] tokens);

    function setUp() public {
        // Deploy tokens
        hyperToken = new MockToken("Hyperscape", "HYPER");
        babylonToken = new MockToken("Babylon", "BABYLON");
        usdcToken = new MockToken("USD Coin", "USDC");

        // Deploy preference registry
        preference = new AppTokenPreference(
            address(0x5555), // token registry
            address(0x6666), // cross chain paymaster
            owner
        );
    }

    // ============ Registration Tests ============

    function test_RegisterApp() public {
        vm.prank(registrant);
        
        vm.expectEmit(true, true, false, true);
        emit AppPreferenceSet(hyperscapeApp, address(hyperToken), "HYPER", true, registrant);
        
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        AppTokenPreference.AppPreference memory pref = preference.getAppPreference(hyperscapeApp);
        assertEq(pref.appAddress, hyperscapeApp);
        assertEq(pref.preferredToken, address(hyperToken));
        assertEq(pref.tokenSymbol, "HYPER");
        assertTrue(pref.allowFallback);
        assertEq(pref.minBalance, 1e18);
        assertTrue(pref.isActive);
        assertEq(pref.registrant, registrant);
    }

    function test_RegisterApp_RevertOnDuplicate() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        vm.prank(registrant);
        vm.expectRevert(abi.encodeWithSelector(AppTokenPreference.AppAlreadyRegistered.selector, hyperscapeApp));
        preference.registerApp(hyperscapeApp, address(babylonToken), true, 1e18);
    }

    function test_RegisterApp_RevertOnZeroAddress() public {
        vm.expectRevert(AppTokenPreference.InvalidAddress.selector);
        preference.registerApp(address(0), address(hyperToken), true, 1e18);
    }

    function test_RegisterApp_RevertOnZeroToken() public {
        vm.expectRevert(abi.encodeWithSelector(AppTokenPreference.InvalidToken.selector, address(0)));
        preference.registerApp(hyperscapeApp, address(0), true, 1e18);
    }

    // ============ Update Tests ============

    function test_UpdatePreferredToken() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        vm.prank(registrant);
        vm.expectEmit(true, true, false, true);
        emit AppPreferenceUpdated(hyperscapeApp, address(babylonToken), "BABYLON");
        preference.updatePreferredToken(hyperscapeApp, address(babylonToken));

        AppTokenPreference.AppPreference memory pref = preference.getAppPreference(hyperscapeApp);
        assertEq(pref.preferredToken, address(babylonToken));
        assertEq(pref.tokenSymbol, "BABYLON");
    }

    function test_UpdatePreferredToken_ByOwner() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        // Owner can also update
        vm.prank(owner);
        preference.updatePreferredToken(hyperscapeApp, address(babylonToken));

        AppTokenPreference.AppPreference memory pref = preference.getAppPreference(hyperscapeApp);
        assertEq(pref.preferredToken, address(babylonToken));
    }

    function test_UpdatePreferredToken_RevertOnUnauthorized() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        vm.prank(user); // Not registrant or owner
        vm.expectRevert(AppTokenPreference.NotAuthorized.selector);
        preference.updatePreferredToken(hyperscapeApp, address(babylonToken));
    }

    function test_UpdatePreferredToken_RevertOnUnregistered() public {
        vm.expectRevert(abi.encodeWithSelector(AppTokenPreference.AppNotRegistered.selector, hyperscapeApp));
        preference.updatePreferredToken(hyperscapeApp, address(babylonToken));
    }

    // ============ Fallback Tokens Tests ============

    function test_SetFallbackTokens() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        address[] memory fallbacks = new address[](2);
        fallbacks[0] = address(usdcToken);
        fallbacks[1] = address(babylonToken);

        vm.prank(registrant);
        vm.expectEmit(true, false, false, true);
        emit FallbackTokensSet(hyperscapeApp, fallbacks);
        preference.setFallbackTokens(hyperscapeApp, fallbacks);

        address[] memory stored = preference.getAppFallbackTokens(hyperscapeApp);
        assertEq(stored.length, 2);
        assertEq(stored[0], address(usdcToken));
        assertEq(stored[1], address(babylonToken));
    }

    // ============ Remove App Tests ============

    function test_RemoveApp() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        vm.prank(registrant);
        vm.expectEmit(true, false, false, false);
        emit AppPreferenceRemoved(hyperscapeApp);
        preference.removeApp(hyperscapeApp);

        AppTokenPreference.AppPreference memory pref = preference.getAppPreference(hyperscapeApp);
        assertFalse(pref.isActive);
    }

    // ============ Token Selection Tests ============

    function test_GetBestPaymentToken_PreferredToken() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        TokenBalance[] memory balances = new TokenBalance[](3);
        balances[0] = TokenBalance(address(hyperToken), 10e18);
        balances[1] = TokenBalance(address(usdcToken), 100e18);
        balances[2] = TokenBalance(address(babylonToken), 50e18);

        (address bestToken, string memory reason) = preference.getBestPaymentToken(hyperscapeApp, user, balances);

        assertEq(bestToken, address(hyperToken));
        assertEq(reason, "App preferred token");
    }

    function test_GetBestPaymentToken_FallbackToken() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        address[] memory fallbacks = new address[](2);
        fallbacks[0] = address(usdcToken);
        fallbacks[1] = address(babylonToken);
        vm.prank(registrant);
        preference.setFallbackTokens(hyperscapeApp, fallbacks);

        // User has USDC but not HYPER
        TokenBalance[] memory balances = new TokenBalance[](2);
        balances[0] = TokenBalance(address(usdcToken), 100e18);
        balances[1] = TokenBalance(address(babylonToken), 50e18);

        (address bestToken, string memory reason) = preference.getBestPaymentToken(hyperscapeApp, user, balances);

        assertEq(bestToken, address(usdcToken));
        assertEq(reason, "App fallback token");
    }

    function test_GetBestPaymentToken_GlobalDefault() public {
        // No app preference, use global defaults
        address[] memory defaults = new address[](2);
        defaults[0] = address(usdcToken);
        defaults[1] = address(hyperToken);
        
        vm.prank(owner);
        preference.setGlobalDefaults(defaults);

        TokenBalance[] memory balances = new TokenBalance[](2);
        balances[0] = TokenBalance(address(hyperToken), 10e18);
        balances[1] = TokenBalance(address(usdcToken), 100e18);

        // No app registered, so use global default
        (address bestToken, string memory reason) = preference.getBestPaymentToken(address(0x9999), user, balances);

        assertEq(bestToken, address(usdcToken)); // First global default
        assertEq(reason, "Global default token");
    }

    function test_GetBestPaymentToken_NoFallbackRequired() public {
        // Register app without fallback allowed
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), false, 1e18);

        // User doesn't have HYPER
        TokenBalance[] memory balances = new TokenBalance[](1);
        balances[0] = TokenBalance(address(usdcToken), 100e18);

        (address bestToken, string memory reason) = preference.getBestPaymentToken(hyperscapeApp, user, balances);

        // Should still return preferred token (will fail if insufficient)
        assertEq(bestToken, address(hyperToken));
        assertEq(reason, "App requires this token");
    }

    function test_GetBestPaymentToken_InsufficientBalance() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 10e18); // Min 10 HYPER

        // User has HYPER but below minimum
        TokenBalance[] memory balances = new TokenBalance[](2);
        balances[0] = TokenBalance(address(hyperToken), 5e18); // Only 5 HYPER
        balances[1] = TokenBalance(address(usdcToken), 100e18);

        // Set fallback
        address[] memory fallbacks = new address[](1);
        fallbacks[0] = address(usdcToken);
        vm.prank(registrant);
        preference.setFallbackTokens(hyperscapeApp, fallbacks);

        (address bestToken, string memory reason) = preference.getBestPaymentToken(hyperscapeApp, user, balances);

        // Should fall back to USDC since HYPER balance is below minimum
        assertEq(bestToken, address(usdcToken));
        assertEq(reason, "App fallback token");
    }

    // ============ Has Preferred Token Tests ============

    function test_HasPreferredToken_True() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        bool hasPref = preference.hasPreferredToken(hyperscapeApp, user, address(hyperToken), 10e18);
        assertTrue(hasPref);
    }

    function test_HasPreferredToken_WrongToken() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        bool hasPref = preference.hasPreferredToken(hyperscapeApp, user, address(usdcToken), 10e18);
        assertFalse(hasPref);
    }

    function test_HasPreferredToken_InsufficientBalance() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 10e18);

        bool hasPref = preference.hasPreferredToken(hyperscapeApp, user, address(hyperToken), 5e18);
        assertFalse(hasPref);
    }

    // ============ Global Defaults Tests ============

    function test_SetGlobalDefaults() public {
        address[] memory defaults = new address[](3);
        defaults[0] = address(usdcToken);
        defaults[1] = address(hyperToken);
        defaults[2] = address(babylonToken);

        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit GlobalDefaultsSet(defaults);
        preference.setGlobalDefaults(defaults);

        address[] memory stored = preference.getGlobalDefaults();
        assertEq(stored.length, 3);
        assertEq(stored[0], address(usdcToken));
        assertEq(stored[1], address(hyperToken));
        assertEq(stored[2], address(babylonToken));
    }

    function test_SetGlobalDefaults_OnlyOwner() public {
        address[] memory defaults = new address[](1);
        defaults[0] = address(usdcToken);

        vm.prank(user);
        vm.expectRevert();
        preference.setGlobalDefaults(defaults);
    }

    // ============ Admin Tests ============

    function test_SetTokenRegistry() public {
        address newRegistry = address(0x7777);
        
        vm.prank(owner);
        preference.setTokenRegistry(newRegistry);

        assertEq(preference.tokenRegistry(), newRegistry);
    }

    function test_SetCrossChainPaymaster() public {
        address newPaymaster = address(0x8888);
        
        vm.prank(owner);
        preference.setCrossChainPaymaster(newPaymaster);

        assertEq(preference.crossChainPaymaster(), newPaymaster);
    }

    // ============ View Functions Tests ============

    function test_GetRegisteredApps() public {
        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);
        
        vm.prank(registrant);
        preference.registerApp(babylonApp, address(babylonToken), true, 1e18);

        address[] memory apps = preference.getRegisteredApps();
        assertEq(apps.length, 2);
        assertEq(apps[0], hyperscapeApp);
        assertEq(apps[1], babylonApp);
    }

    function test_GetAppCount() public {
        assertEq(preference.getAppCount(), 0);

        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);
        assertEq(preference.getAppCount(), 1);

        vm.prank(registrant);
        preference.registerApp(babylonApp, address(babylonToken), true, 1e18);
        assertEq(preference.getAppCount(), 2);
    }

    function test_Version() public view {
        assertEq(preference.version(), "1.0.0");
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterApp(address app, uint256 minBalance) public {
        vm.assume(app != address(0));
        vm.assume(minBalance > 0 && minBalance < type(uint128).max);

        vm.prank(registrant);
        preference.registerApp(app, address(hyperToken), true, minBalance);

        AppTokenPreference.AppPreference memory pref = preference.getAppPreference(app);
        assertEq(pref.minBalance, minBalance);
        assertTrue(pref.isActive);
    }

    function testFuzz_TokenBalanceSelection(uint256 balance1, uint256 balance2) public {
        vm.assume(balance1 > 1e18 && balance1 < type(uint128).max);
        vm.assume(balance2 > 1e18 && balance2 < type(uint128).max);

        vm.prank(registrant);
        preference.registerApp(hyperscapeApp, address(hyperToken), true, 1e18);

        TokenBalance[] memory balances = new TokenBalance[](2);
        balances[0] = TokenBalance(address(hyperToken), balance1);
        balances[1] = TokenBalance(address(usdcToken), balance2);

        (address bestToken,) = preference.getBestPaymentToken(hyperscapeApp, user, balances);

        // Should always return preferred token if balance is sufficient
        assertEq(bestToken, address(hyperToken));
    }
}
