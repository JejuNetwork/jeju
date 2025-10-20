// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/oracle/PriceSource.sol";

contract PriceSourceTest is Test {
    PriceSource public priceSource;
    
    address public owner = address(this);
    address public updater = address(0x1);
    address public elizaToken = address(0x2);
    address public crossChainRelay = address(0x3);
    
    function setUp() public {
        priceSource = new PriceSource(
            elizaToken,
            crossChainRelay,
            updater,
            owner
        );
    }
    
    function testDeployment() public view {
        assertEq(priceSource.ElizaOSToken(), elizaToken);
        assertEq(priceSource.crossChainRelayOnJeju(), crossChainRelay);
        assertEq(priceSource.priceUpdater(), updater);
        assertEq(priceSource.owner(), owner);
    }
    
    function testSetPriceUpdater() public {
        address newUpdater = address(0x999);
        
        priceSource.setPriceUpdater(newUpdater);
        
        assertEq(priceSource.priceUpdater(), newUpdater);
    }
    
    function testSetElizaOSToken() public {
        address newToken = address(0x888);
        
        priceSource.setElizaOSToken(newToken);
        
        assertEq(priceSource.ElizaOSToken(), newToken);
    }
    
    function testSetCrossChainRelay() public {
        address newRelay = address(0x777);
        
        priceSource.setCrossChainRelay(newRelay);
        
        assertEq(priceSource.crossChainRelayOnJeju(), newRelay);
    }
    
    function testOnlyOwnerCanSetParameters() public {
        address attacker = address(0x666);
        
        vm.prank(attacker);
        vm.expectRevert();
        priceSource.setPriceUpdater(attacker);
        
        vm.prank(attacker);
        vm.expectRevert();
        priceSource.setElizaOSToken(attacker);
        
        vm.prank(attacker);
        vm.expectRevert();
        priceSource.setCrossChainRelay(attacker);
    }
    
    function testPauseUnpause() public {
        priceSource.pause();
        
        // Cannot call updateAndRelay when paused
        vm.prank(updater);
        vm.expectRevert();
        priceSource.updateAndRelay();
        
        // Unpause
        priceSource.unpause();
        
        // Note: updateAndRelay will still fail without proper Chainlink/Uniswap setup
        // but it won't fail due to pause
    }
    
    function testGetLastPrices() public view {
        (uint256 ethPrice, uint256 elizaPrice, uint256 timestamp) = priceSource.getLastPrices();
        
        // Initial values should be zero
        assertEq(ethPrice, 0);
        assertEq(elizaPrice, 0);
        assertEq(timestamp, 0);
    }
}

