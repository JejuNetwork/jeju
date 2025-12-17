// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RegistryHub} from "../../src/federation/RegistryHub.sol";

contract RegistryHubTest is Test {
    RegistryHub public hub;
    
    address public owner = address(0x1);
    address public operator1 = address(0x2);
    address public operator2 = address(0x3);
    address public wormholeRelayer = address(0x4);
    
    uint256 constant CHAIN_ID_1 = 420690;
    uint256 constant CHAIN_ID_2 = 420691;
    
    function setUp() public {
        vm.prank(owner);
        hub = new RegistryHub(wormholeRelayer);
    }
    
    function test_RegisterChainUnstaked() public {
        vm.prank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Test Network",
            "https://rpc.test.network"
        );
        
        RegistryHub.ChainInfo memory chain = hub.getChain(CHAIN_ID_1);
        
        assertEq(chain.chainId, CHAIN_ID_1);
        assertEq(chain.name, "Test Network");
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.UNSTAKED));
        assertEq(chain.isActive, true);
    }
    
    function test_RegisterChainStaked() public {
        vm.deal(operator1, 2 ether);
        vm.prank(operator1);
        hub.registerChain{value: 1 ether}(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Staked Network",
            "https://rpc.staked.network"
        );
        
        RegistryHub.ChainInfo memory chain = hub.getChain(CHAIN_ID_1);
        
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.STAKED));
        assertEq(chain.stake, 1 ether);
    }
    
    function test_RegisterChainVerified() public {
        vm.deal(operator1, 15 ether);
        vm.prank(operator1);
        hub.registerChain{value: 10 ether}(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Verified Network",
            "https://rpc.verified.network"
        );
        
        RegistryHub.ChainInfo memory chain = hub.getChain(CHAIN_ID_1);
        
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.VERIFIED));
        assertEq(chain.stake, 10 ether);
    }
    
    function test_AddStakeUpgradesTier() public {
        // Register unstaked
        vm.prank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Upgrade Network",
            "https://rpc.upgrade.network"
        );
        
        RegistryHub.ChainInfo memory chain = hub.getChain(CHAIN_ID_1);
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.UNSTAKED));
        
        // Add stake
        vm.deal(operator1, 2 ether);
        vm.prank(operator1);
        hub.addStake{value: 1 ether}(CHAIN_ID_1);
        
        chain = hub.getChain(CHAIN_ID_1);
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.STAKED));
        assertEq(chain.stake, 1 ether);
    }
    
    function test_RegisterRegistry() public {
        // Register chain first
        vm.prank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Registry Network",
            "https://rpc.registry.network"
        );
        
        // Register registry
        bytes32 contractAddress = bytes32(uint256(uint160(address(0x5))));
        vm.prank(operator1);
        hub.registerRegistry(
            CHAIN_ID_1,
            RegistryHub.RegistryType.IDENTITY,
            contractAddress,
            "Identity Registry",
            "1.0.0",
            "ipfs://metadata"
        );
        
        bytes32 registryId = hub.computeRegistryId(
            CHAIN_ID_1,
            RegistryHub.RegistryType.IDENTITY,
            contractAddress
        );
        
        RegistryHub.RegistryInfo memory registry = hub.getRegistry(registryId);
        
        assertEq(registry.chainId, CHAIN_ID_1);
        assertEq(uint8(registry.registryType), uint8(RegistryHub.RegistryType.IDENTITY));
        assertEq(registry.name, "Identity Registry");
        assertEq(registry.isActive, true);
    }
    
    function test_IsTrustedForConsensus() public {
        // Unstaked chain
        vm.prank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Unstaked",
            "https://rpc.unstaked.network"
        );
        
        assertEq(hub.isTrustedForConsensus(CHAIN_ID_1), false);
        
        // Staked chain
        vm.deal(operator2, 2 ether);
        vm.prank(operator2);
        hub.registerChain{value: 1 ether}(
            CHAIN_ID_2,
            RegistryHub.ChainType.EVM,
            "Staked",
            "https://rpc.staked.network"
        );
        
        assertEq(hub.isTrustedForConsensus(CHAIN_ID_2), true);
    }
    
    function test_RegisterSolanaRegistry() public {
        bytes32 programId = bytes32(uint256(0x123456));
        
        vm.deal(operator1, 2 ether);
        vm.prank(operator1);
        hub.registerSolanaRegistry{value: 1 ether}(
            programId,
            RegistryHub.RegistryType.IDENTITY,
            "Solana Identity",
            "ipfs://solana-metadata"
        );
        
        // Check Solana chain was registered
        RegistryHub.ChainInfo memory chain = hub.getChain(hub.WORMHOLE_SOLANA());
        assertEq(chain.name, "Solana");
        assertEq(uint8(chain.chainType), uint8(RegistryHub.ChainType.SOLANA));
        
        assertEq(hub.totalRegistries(), 1);
    }
    
    function test_GetStakedChains() public {
        // Register unstaked
        vm.prank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Unstaked",
            "https://rpc.unstaked.network"
        );
        
        // Register staked
        vm.deal(operator2, 2 ether);
        vm.prank(operator2);
        hub.registerChain{value: 1 ether}(
            CHAIN_ID_2,
            RegistryHub.ChainType.EVM,
            "Staked",
            "https://rpc.staked.network"
        );
        
        uint256[] memory stakedChains = hub.getStakedChains();
        
        assertEq(stakedChains.length, 1);
        assertEq(stakedChains[0], CHAIN_ID_2);
    }
    
    function test_RevertWhen_RegisterChainTwice() public {
        vm.startPrank(operator1);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "First",
            "https://rpc.first.network"
        );
        
        vm.expectRevert(RegistryHub.ChainExists.selector);
        hub.registerChain(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Second",
            "https://rpc.second.network"
        );
        vm.stopPrank();
    }
    
    function test_RevertWhen_WithdrawStakeWhileActive() public {
        vm.deal(operator1, 2 ether);
        vm.startPrank(operator1);
        hub.registerChain{value: 1 ether}(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Active",
            "https://rpc.active.network"
        );
        
        vm.expectRevert(RegistryHub.StillActive.selector);
        hub.withdrawStake(CHAIN_ID_1);
        vm.stopPrank();
    }
    
    function test_DeactivateAndWithdraw() public {
        vm.deal(operator1, 2 ether);
        vm.startPrank(operator1);
        
        hub.registerChain{value: 1 ether}(
            CHAIN_ID_1,
            RegistryHub.ChainType.EVM,
            "Deactivate",
            "https://rpc.deactivate.network"
        );
        
        uint256 balanceBefore = operator1.balance;
        
        hub.deactivateChain(CHAIN_ID_1);
        hub.withdrawStake(CHAIN_ID_1);
        
        vm.stopPrank();
        
        assertEq(operator1.balance, balanceBefore + 1 ether);
        
        RegistryHub.ChainInfo memory chain = hub.getChain(CHAIN_ID_1);
        assertEq(chain.stake, 0);
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.UNSTAKED));
    }
}

