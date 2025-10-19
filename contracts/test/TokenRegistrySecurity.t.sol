// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TokenRegistry} from "../src/paymaster/TokenRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Malicious Token for Testing
 * @dev Implements fee-on-transfer to test registry rejection
 */
contract FeeOnTransferToken is ERC20 {
    uint256 public feePercent = 10; // 10% fee
    
    constructor() ERC20("FeeToken", "FEE") {
        _mint(msg.sender, 1000000 * 1e18);
    }
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feePercent) / 100;
        uint256 amountAfterFee = amount - fee;
        
        _transfer(msg.sender, to, amountAfterFee);
        _transfer(msg.sender, address(this), fee); // Take fee
        
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feePercent) / 100;
        uint256 amountAfterFee = amount - fee;
        
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amountAfterFee);
        _transfer(from, address(this), fee); // Take fee
        
        return true;
    }
}

contract GoodToken is ERC20 {
    constructor() ERC20("GoodToken", "GOOD") {
        _mint(msg.sender, 1000000 * 1e18);
    }
}

contract MockOracle {
    function getPrice(address) external pure returns (uint256, uint256) {
        return (1e18, 18);
    }
    
    function isPriceFresh(address) external pure returns (bool) {
        return true;
    }
}

/**
 * @title TokenRegistry Security Tests
 * @notice Comprehensive security testing for token registration
 */
contract TokenRegistrySecurityTest is Test {
    TokenRegistry public registry;
    MockOracle public oracle;
    
    FeeOnTransferToken public feeToken;
    GoodToken public goodToken;
    
    address owner = address(this);
    address treasury = makeAddr("treasury");
    address attacker = makeAddr("attacker");
    address user1 = makeAddr("user1");
    
    function setUp() public {
        registry = new TokenRegistry(owner, treasury);
        oracle = new MockOracle();
        
        feeToken = new FeeOnTransferToken();
        goodToken = new GoodToken();
        
        vm.deal(attacker, 10 ether);
        vm.deal(user1, 10 ether);
    }
    
    // ============ Malicious Token Tests ============
    
    function test_RejectFeeOnTransferToken() public {
        // Approve registry to test transfer (needs 100 tokens for fee detection)
        feeToken.approve(address(registry), 100);

        // Try to register fee-on-transfer token
        vm.expectRevert(abi.encodeWithSelector(
            TokenRegistry.FeeOnTransferToken.selector,
            address(feeToken)
        ));

        registry.registerToken{value: 0.1 ether}(
            address(feeToken),
            address(oracle),
            0,
            200
        );
    }
    
    function test_AcceptNormalToken() public {
        // Approve registry to test transfer (needs 100 tokens for validation)
        goodToken.approve(address(registry), 100);
        
        // Should succeed
        uint256 tokenId = registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        assertEq(tokenId, 0);
        assertTrue(registry.isTokenSupported(address(goodToken)));
    }
    
    function test_RejectZeroAddressToken() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidToken.selector, address(0)));
        
        registry.registerToken{value: 0.1 ether}(
            address(0),
            address(oracle),
            0,
            200
        );
    }
    
    function test_RejectZeroAddressOracle() public {
        vm.expectRevert(abi.encodeWithSelector(TokenRegistry.InvalidOracle.selector, address(0)));
        
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(0),
            0,
            200
        );
    }
    
    // ============ Fee Manipulation Tests ============
    
    function test_CannotExceedGlobalMaxFee() public {
        vm.expectRevert(abi.encodeWithSelector(
            TokenRegistry.FeesOutsideGlobalBounds.selector,
            0,
            600 // 6% > 5% max
        ));
        
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            600 // Try to set 6% max (global max is 5%)
        );
    }
    
    function test_CannotSetMinBelowGlobalMin() public {
        // Set global minimum to 1%
        registry.setGlobalFeeLimits(100, 500);
        
        vm.expectRevert(abi.encodeWithSelector(
            TokenRegistry.FeesOutsideGlobalBounds.selector,
            0,
            200
        ));
        
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0, // Try to set 0% min when global min is 1%
            200
        );
    }
    
    // ============ Spam Prevention Tests ============
    
    function test_RegistrationFeePreventsSpam() public {
        // Try to register without fee
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(
            TokenRegistry.InsufficientRegistrationFee.selector,
            0.1 ether,
            0
        ));
        
        registry.registerToken(
            address(goodToken),
            address(oracle),
            0,
            200
        );
    }
    
    function test_RegistrationFeeGoesToTreasury() public {
        uint256 treasuryBefore = treasury.balance;
        
        vm.prank(user1);
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        assertEq(treasury.balance, treasuryBefore + 0.1 ether);
    }
    
    // ============ Volume Overflow Tests ============
    
    function test_VolumeTracking_NoOverflow() public {
        vm.prank(user1);
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        // Update volume many times
        for (uint256 i = 0; i < 100; i++) {
            registry.updateTokenVolume(address(goodToken), 1 ether);
        }
        
        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(goodToken));
        assertEq(config.totalVolume, 100 ether);
        assertEq(config.totalTransactions, 100);
    }
    
    function test_VolumeTracking_LargeValues() public {
        vm.prank(user1);
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        // Update with large volume
        registry.updateTokenVolume(address(goodToken), 1000000 ether);
        
        TokenRegistry.TokenConfig memory config = registry.getTokenConfig(address(goodToken));
        assertEq(config.totalVolume, 1000000 ether);
    }
    
    // ============ Access Control Tests ============
    
    function test_OnlyOwnerCanDeactivateToken() public {
        vm.prank(user1);
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        vm.prank(attacker);
        vm.expectRevert();
        registry.deactivateToken(address(goodToken));
    }
    
    function test_OnlyOwnerCanSetGlobalLimits() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.setGlobalFeeLimits(0, 300);
    }
    
    function test_OnlyRegistrantCanUpdateMetadata() public {
        vm.prank(user1);
        registry.registerToken{value: 0.1 ether}(
            address(goodToken),
            address(oracle),
            0,
            200
        );
        
        vm.prank(attacker);
        vm.expectRevert("Only registrant");
        registry.updateMetadata(address(goodToken), keccak256("hack"));
    }
    
    // ============ Gas Griefing Tests ============
    
    function test_GetAllTokens_BoundedGas() public {
        // Register 50 tokens
        for (uint256 i = 0; i < 50; i++) {
            GoodToken token = new GoodToken();
            vm.prank(user1);
            registry.registerToken{value: 0.1 ether}(
                address(token),
                address(oracle),
                0,
                200
            );
        }
        
        uint256 gasBefore = gasleft();
        address[] memory tokens = registry.getAllTokens();
        uint256 gasUsed = gasBefore - gasleft();
        
        assertEq(tokens.length, 50);
        console2.log("Gas to get 50 tokens:", gasUsed);
        
        // Should be reasonable
        assertLt(gasUsed, 1000000); // <1M gas
    }
}

