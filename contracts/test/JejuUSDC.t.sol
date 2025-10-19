// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {JejuUSDC} from "../src/tokens/JejuUSDC.sol";

contract JejuUSDCTest is Test {
    JejuUSDC public usdc;
    
    address owner = address(this);
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant INITIAL_SUPPLY = 1_000_000 * 1e6; // 1M USDC

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    function setUp() public {
        usdc = new JejuUSDC(treasury, INITIAL_SUPPLY, true); // Enable faucet for tests
    }

    // ============ Basic ERC-20 Tests ============

    function test_Deployment() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.totalSupply(), INITIAL_SUPPLY);
        assertEq(usdc.balanceOf(owner), INITIAL_SUPPLY);
    }

    function test_Transfer() public {
        uint256 amount = 100 * 1e6;
        
        usdc.transfer(alice, amount);
        
        assertEq(usdc.balanceOf(alice), amount);
        assertEq(usdc.balanceOf(owner), INITIAL_SUPPLY - amount);
    }

    function test_Approve() public {
        uint256 amount = 500 * 1e6;
        
        usdc.approve(alice, amount);
        
        assertEq(usdc.allowance(owner, alice), amount);
    }

    function test_TransferFrom() public {
        uint256 amount = 200 * 1e6;
        
        usdc.approve(alice, amount);
        
        vm.prank(alice);
        usdc.transferFrom(owner, bob, amount);
        
        assertEq(usdc.balanceOf(bob), amount);
    }

    // ============ Minting Tests ============

    function test_MintByOwner() public {
        uint256 mintAmount = 1000 * 1e6;
        
        usdc.mint(alice, mintAmount);
        
        assertEq(usdc.balanceOf(alice), mintAmount);
        assertEq(usdc.totalSupply(), INITIAL_SUPPLY + mintAmount);
    }

    function test_MintByTreasury() public {
        uint256 mintAmount = 500 * 1e6;
        
        vm.prank(treasury);
        usdc.mint(bob, mintAmount);
        
        assertEq(usdc.balanceOf(bob), mintAmount);
    }

    function test_RevertMintUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert("Unauthorized");
        usdc.mint(bob, 100 * 1e6);
    }

    // ============ Burning Tests ============

    function test_Burn() public {
        uint256 burnAmount = 100 * 1e6;
        
        usdc.burn(burnAmount);
        
        assertEq(usdc.balanceOf(owner), INITIAL_SUPPLY - burnAmount);
        assertEq(usdc.totalSupply(), INITIAL_SUPPLY - burnAmount);
    }

    // ============ EIP-3009: Transfer With Authorization Tests ============

    function test_TransferWithAuthorization() public {
        uint256 aliceKey = 0xA11CE;
        address aliceAddr = vm.addr(aliceKey);
        
        // Give Alice some USDC
        usdc.transfer(aliceAddr, 1000 * 1e6);
        
        // Alice signs authorization to transfer to Bob
        uint256 amount = 100 * 1e6;
        uint256 validAfter = block.timestamp;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("nonce1");
        
        bytes32 digest = _getTransferWithAuthorizationDigest(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        
        // Anyone can execute the authorization
        vm.prank(owner);
        usdc.transferWithAuthorization(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        
        assertEq(usdc.balanceOf(bob), amount);
        assertEq(usdc.balanceOf(aliceAddr), 900 * 1e6);
        assertTrue(usdc.authorizationState(aliceAddr, nonce));
    }

    function test_RevertTransferWithAuthorizationReplay() public {
        uint256 aliceKey = 0xA11CE;
        address aliceAddr = vm.addr(aliceKey);
        
        usdc.transfer(aliceAddr, 1000 * 1e6);
        
        uint256 amount = 100 * 1e6;
        bytes32 nonce = keccak256("nonce2");
        uint256 validAfter = block.timestamp;
        uint256 validBefore = block.timestamp + 1 hours;
        
        bytes32 digest = _getTransferWithAuthorizationDigest(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        
        // First execution succeeds
        usdc.transferWithAuthorization(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        
        // Second execution fails (nonce already used)
        vm.expectRevert(
            abi.encodeWithSelector(
                JejuUSDC.AuthorizationAlreadyUsed.selector,
                aliceAddr,
                nonce
            )
        );
        usdc.transferWithAuthorization(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function test_RevertTransferWithAuthorizationNotYetValid() public {
        uint256 aliceKey = 0xA11CE;
        address aliceAddr = vm.addr(aliceKey);
        
        usdc.transfer(aliceAddr, 1000 * 1e6);
        
        uint256 amount = 100 * 1e6;
        bytes32 nonce = keccak256("nonce3");
        uint256 validAfter = block.timestamp + 1 hours; // Future
        uint256 validBefore = block.timestamp + 2 hours;
        
        bytes32 digest = _getTransferWithAuthorizationDigest(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        
        vm.expectRevert(
            abi.encodeWithSelector(
                JejuUSDC.AuthorizationNotYetValid.selector,
                block.timestamp,
                validAfter
            )
        );
        usdc.transferWithAuthorization(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function test_RevertTransferWithAuthorizationExpired() public {
        uint256 aliceKey = 0xA11CE;
        address aliceAddr = vm.addr(aliceKey);
        
        usdc.transfer(aliceAddr, 1000 * 1e6);
        
        uint256 amount = 100 * 1e6;
        bytes32 nonce = keccak256("nonce4");
        uint256 validAfter = 100; // Past timestamp
        uint256 validBefore = 200; // Expired timestamp
        
        // Warp to future so authorization is expired
        vm.warp(300);
        
        bytes32 digest = _getTransferWithAuthorizationDigest(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        
        vm.expectRevert(
            abi.encodeWithSelector(
                JejuUSDC.AuthorizationExpired.selector,
                block.timestamp,
                validBefore
            )
        );
        usdc.transferWithAuthorization(
            aliceAddr,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function test_CancelAuthorization() public {
        bytes32 nonce = keccak256("nonce5");
        
        usdc.cancelAuthorization(owner, nonce);
        
        assertTrue(usdc.authorizationState(owner, nonce));
    }

    // ============ Faucet Tests ============

    function test_Faucet() public {
        vm.prank(alice);
        usdc.faucet();
        
        assertEq(usdc.balanceOf(alice), 100 * 1e6); // Default faucet amount
    }

    function test_RevertFaucetCooldown() public {
        vm.prank(alice);
        usdc.faucet();
        
        // Try immediately again
        vm.prank(alice);
        vm.expectRevert();
        usdc.faucet();
    }

    function test_FaucetAfterCooldown() public {
        vm.prank(alice);
        usdc.faucet();
        
        // Wait 24 hours
        vm.warp(block.timestamp + 24 hours + 1);
        
        vm.prank(alice);
        usdc.faucet();
        
        assertEq(usdc.balanceOf(alice), 200 * 1e6); // Two faucet claims
    }

    function test_DisableFaucet() public {
        usdc.configureFaucet(false, 100 * 1e6, 24 hours);
        
        vm.prank(alice);
        vm.expectRevert(JejuUSDC.FaucetDisabled.selector);
        usdc.faucet();
    }

    // ============ Admin Tests ============

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        
        usdc.setTreasury(newTreasury);
        
        assertEq(usdc.treasury(), newTreasury);
    }

    function test_ConfigureFaucet() public {
        uint256 newAmount = 50 * 1e6;
        uint256 newCooldown = 12 hours;
        
        usdc.configureFaucet(true, newAmount, newCooldown);
        
        assertEq(usdc.faucetAmount(), newAmount);
        assertEq(usdc.faucetCooldown(), newCooldown);
    }

    // ============ Helper Functions ============

    function _getTransferWithAuthorizationDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdc.DOMAIN_SEPARATOR(),
                structHash
            )
        );
    }
}

