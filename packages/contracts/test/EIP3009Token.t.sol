// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Token} from "../src/tokens/Token.sol";

contract EIP3009TokenTest is Test {
    Token public token;
    
    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public relayer = address(0x4);
    
    uint256 public alicePrivateKey = 0xA11CE;
    uint256 public bobPrivateKey = 0xB0B;
    
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    
    function _getDomainSeparator() internal view returns (bytes32) {
        (,string memory name, string memory version,,,,) = token.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(token)
            )
        );
    }
    
    function setUp() public {
        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);
        
        vm.prank(owner);
        token = new Token("USD Coin", "USDC", 100_000_000 * 1e18, owner, 0, true);
        
        // Fund alice with tokens
        vm.prank(owner);
        token.mint(alice, 1_000_000 * 1e18); // 1M
    }
    
    function test_Constructor() public view {
        assertEq(token.name(), "USD Coin");
        assertEq(token.symbol(), "USDC");
        assertEq(token.decimals(), 18);
    }
    
    function test_InitialSupply() public view {
        // Owner gets initial supply
        uint256 expectedOwner = 100_000_000 * 1e18;
        uint256 expectedAlice = 1_000_000 * 1e18;
        
        assertEq(token.balanceOf(owner), expectedOwner);
        assertEq(token.balanceOf(alice), expectedAlice);
    }
    
    function test_Faucet() public {
        vm.prank(owner);
        token.setConfig(0, 0, false, false, true);
        
        // Warp past cooldown
        vm.warp(block.timestamp + token.faucetCooldown() + 1);
        
        vm.prank(bob);
        token.faucet();
        
        assertEq(token.balanceOf(bob), token.faucetAmount());
    }
    
    function test_TransferWithAuthorization() public {
        uint256 amount = 100_000 * 1e18;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256("test-nonce-1");
        
        // Sign the authorization
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _getDomainSeparator(),
                structHash
            )
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        
        // Execute as relayer (gasless for alice)
        vm.prank(relayer);
        token.transferWithAuthorization(
            alice,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            signature
        );
        
        assertEq(token.balanceOf(alice), aliceBefore - amount);
        assertEq(token.balanceOf(bob), bobBefore + amount);
    }
    
    function test_RevertWhen_AuthorizationExpired() public {
        // Warp to a reasonable timestamp first
        vm.warp(1700000000);
        
        uint256 amount = 100_000 * 1e18;
        uint256 validAfter = block.timestamp - 3600;
        uint256 validBefore = block.timestamp - 1; // Already expired
        bytes32 nonce = keccak256("test-nonce-expired");
        
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _getDomainSeparator(),
                structHash
            )
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(relayer);
        vm.expectRevert(Token.AuthorizationExpired.selector);
        token.transferWithAuthorization(
            alice,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            signature
        );
    }
    
    function test_RevertWhen_AuthorizationNotYetValid() public {
        uint256 amount = 100_000 * 1e18;
        uint256 validAfter = block.timestamp + 3600; // Not yet valid
        uint256 validBefore = block.timestamp + 7200;
        bytes32 nonce = keccak256("test-nonce-future");
        
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _getDomainSeparator(),
                structHash
            )
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(relayer);
        vm.expectRevert(Token.AuthorizationNotYetValid.selector);
        token.transferWithAuthorization(
            alice,
            bob,
            amount,
            validAfter,
            validBefore,
            nonce,
            signature
        );
    }
    
    function test_RevertWhen_AuthorizationReused() public {
        uint256 amount = 100_000 * 1e18;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256("test-nonce-reuse");
        
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _getDomainSeparator(),
                structHash
            )
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // First use succeeds
        vm.prank(relayer);
        token.transferWithAuthorization(alice, bob, amount, validAfter, validBefore, nonce, signature);
        
        // Second use fails
        vm.prank(relayer);
        vm.expectRevert(Token.AuthorizationAlreadyUsed.selector);
        token.transferWithAuthorization(alice, bob, amount, validAfter, validBefore, nonce, signature);
    }
    
    function test_RevertWhen_InvalidSignature() public {
        uint256 amount = 100_000 * 1e18;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256("test-nonce-invalid");
        
        // Sign with bob's key instead of alice's
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice, // From alice
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _getDomainSeparator(),
                structHash
            )
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobPrivateKey, digest); // Wrong signer
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(relayer);
        vm.expectRevert(Token.InvalidSignature.selector);
        token.transferWithAuthorization(alice, bob, amount, validAfter, validBefore, nonce, signature);
    }
    
    function test_AuthorizationState() public {
        bytes32 nonce = keccak256("test-nonce-state");
        
        // Initially not used
        assertFalse(token.authorizationState(alice, nonce));
        
        // Execute a transfer
        uint256 amount = 1000 * 1e18;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(relayer);
        token.transferWithAuthorization(alice, bob, amount, validAfter, validBefore, nonce, signature);
        
        // Now marked as used
        assertTrue(token.authorizationState(alice, nonce));
    }
    
    function testFuzz_TransferWithAuthorization(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 1_000_000 * 1e18);
        
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256(abi.encode("fuzz-nonce", amount));
        
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                alice,
                bob,
                uint256(amount),
                validAfter,
                validBefore,
                nonce
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        
        vm.prank(relayer);
        token.transferWithAuthorization(alice, bob, amount, validAfter, validBefore, nonce, signature);
        
        assertEq(token.balanceOf(alice), aliceBefore - amount);
        assertEq(token.balanceOf(bob), bobBefore + amount);
    }
}
