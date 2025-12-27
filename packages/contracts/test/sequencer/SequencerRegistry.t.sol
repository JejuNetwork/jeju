// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/sequencer/SequencerRegistry.sol";
import "../../src/bridge/ForcedInclusion.sol";
import "../../src/registry/IdentityRegistry.sol";
import "../../src/registry/ReputationRegistry.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockBatchInbox {
    bytes public lastData;

    fallback() external payable {
        lastData = msg.data;
    }

    receive() external payable {}
}

/// @title SequencerRegistryTest
/// @notice Tests for permissionless SequencerRegistry with cryptographic verification
contract SequencerRegistryTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    SequencerRegistry public registry;
    ForcedInclusion public forcedInclusion;
    MockJEJU public token;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    MockBatchInbox public batchInbox;

    address public owner = address(1);
    address public treasury = address(2);
    address public reporter = address(3);

    // Test sequencers with keys for signing
    address public sequencer1;
    uint256 public sequencer1Key;
    address public sequencer2;
    uint256 public sequencer2Key;
    address public sequencer3;
    uint256 public sequencer3Key;

    uint256 public agentId1;
    uint256 public agentId2;
    uint256 public agentId3;

    function setUp() public {
        (sequencer1, sequencer1Key) = makeAddrAndKey("sequencer1");
        (sequencer2, sequencer2Key) = makeAddrAndKey("sequencer2");
        (sequencer3, sequencer3Key) = makeAddrAndKey("sequencer3");

        vm.startPrank(owner);

        // Deploy token
        token = new MockJEJU();

        // Deploy identity and reputation registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));

        // Deploy batch inbox mock
        batchInbox = new MockBatchInbox();

        // Deploy registry
        registry = new SequencerRegistry(
            address(token), address(identityRegistry), address(reputationRegistry), treasury, owner
        );

        // Deploy forced inclusion
        address securityCouncil = address(0x999);
        forcedInclusion = new ForcedInclusion(
            address(batchInbox),
            address(registry),
            securityCouncil,
            owner,
            true // Skip contract check in tests
        );

        // Set forced inclusion on registry
        registry.setForcedInclusion(address(forcedInclusion));

        vm.stopPrank();

        // Register agents
        vm.prank(sequencer1);
        agentId1 = identityRegistry.register("ipfs://agent1");
        vm.prank(sequencer2);
        agentId2 = identityRegistry.register("ipfs://agent2");
        vm.prank(sequencer3);
        agentId3 = identityRegistry.register("ipfs://agent3");

        // Fund and approve tokens
        token.mint(sequencer1, 20000 ether);
        token.mint(sequencer2, 20000 ether);
        token.mint(sequencer3, 20000 ether);

        vm.prank(sequencer1);
        token.approve(address(registry), 20000 ether);
        vm.prank(sequencer2);
        token.approve(address(registry), 20000 ether);
        vm.prank(sequencer3);
        token.approve(address(registry), 20000 ether);

        // Register sequencers
        vm.prank(sequencer1);
        registry.register(agentId1, 1000 ether);
        vm.prank(sequencer2);
        registry.register(agentId2, 1500 ether);
        vm.prank(sequencer3);
        registry.register(agentId3, 2000 ether);
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    function _signBlockProposal(uint256 privateKey, uint256 blockNumber, bytes32 blockHash)
        internal
        view
        returns (bytes memory)
    {
        bytes32 message = keccak256(abi.encodePacked("BLOCK_PROPOSED", block.chainid, blockNumber, blockHash));
        bytes32 ethSignedMessage = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedMessage);
        return abi.encodePacked(r, s, v);
    }

    // =========================================================================
    // recordBlockProposed Tests
    // =========================================================================

    function test_recordBlockProposed_WithValidSignature() public {
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");
        bytes memory signature = _signBlockProposal(sequencer1Key, blockNumber, blockHash);

        vm.prank(sequencer1);
        registry.recordBlockProposed(blockNumber, blockHash, signature);

        // Verify block was recorded
        assertEq(registry.sequencerBlockHashes(sequencer1, blockNumber), blockHash);

        (,,,, uint256 lastBlock, uint256 blocksProposed,,,,,) = registry.sequencers(sequencer1);
        assertEq(lastBlock, blockNumber);
        assertEq(blocksProposed, 1);
    }

    function test_recordBlockProposed_RejectsInvalidSignature() public {
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");
        // Sign with wrong key
        bytes memory signature = _signBlockProposal(sequencer2Key, blockNumber, blockHash);

        vm.prank(sequencer1);
        vm.expectRevert(SequencerRegistry.InvalidSignature.selector);
        registry.recordBlockProposed(blockNumber, blockHash, signature);
    }

    function test_recordBlockProposed_RejectsNonSequencer() public {
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");

        // Create a new address that's not a sequencer
        (address nonSequencer, uint256 nonSequencerKey) = makeAddrAndKey("nonSequencer");
        bytes memory signature = _signBlockProposal(nonSequencerKey, blockNumber, blockHash);

        vm.prank(nonSequencer);
        vm.expectRevert(SequencerRegistry.NotActiveSequencer.selector);
        registry.recordBlockProposed(blockNumber, blockHash, signature);
    }

    function test_recordBlockProposed_DetectsDoubleSign() public {
        uint256 blockNumber = 100;
        bytes32 blockHash1 = keccak256("block100v1");
        bytes32 blockHash2 = keccak256("block100v2");

        // First block proposal
        bytes memory sig1 = _signBlockProposal(sequencer1Key, blockNumber, blockHash1);
        vm.prank(sequencer1);
        registry.recordBlockProposed(blockNumber, blockHash1, sig1);

        // Second proposal with different hash - should slash
        bytes memory sig2 = _signBlockProposal(sequencer1Key, blockNumber, blockHash2);
        vm.prank(sequencer1);
        registry.recordBlockProposed(blockNumber, blockHash2, sig2);

        // Verify sequencer was slashed
        (,,,,,,,,,, bool isSlashed) = registry.sequencers(sequencer1);
        assertTrue(isSlashed);
    }

    function test_recordBlockProposed_RejectsAlreadyProposed() public {
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");
        bytes memory signature = _signBlockProposal(sequencer1Key, blockNumber, blockHash);

        vm.prank(sequencer1);
        registry.recordBlockProposed(blockNumber, blockHash, signature);

        // Try to propose same block again
        vm.prank(sequencer1);
        vm.expectRevert(SequencerRegistry.BlockAlreadyProposed.selector);
        registry.recordBlockProposed(blockNumber, blockHash, signature);
    }

    // =========================================================================
    // slashDoubleSign Tests
    // =========================================================================

    function test_slashDoubleSign_WithValidProof() public {
        uint256 blockNumber = 100;
        bytes32 blockHash1 = keccak256("block100v1");
        bytes32 blockHash2 = keccak256("block100v2");

        bytes memory sig1 = _signBlockProposal(sequencer1Key, blockNumber, blockHash1);
        bytes memory sig2 = _signBlockProposal(sequencer1Key, blockNumber, blockHash2);

        // Anyone can submit the double-sign proof
        vm.prank(reporter);
        registry.slashDoubleSign(sequencer1, blockNumber, blockHash1, sig1, blockHash2, sig2);

        // Verify sequencer was slashed
        (,,,,,,,,,, bool isSlashed) = registry.sequencers(sequencer1);
        assertTrue(isSlashed);
    }

    function test_slashDoubleSign_RejectsSameBlockHash() public {
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");

        bytes memory sig1 = _signBlockProposal(sequencer1Key, blockNumber, blockHash);
        bytes memory sig2 = _signBlockProposal(sequencer1Key, blockNumber, blockHash);

        vm.prank(reporter);
        vm.expectRevert(SequencerRegistry.SameBlockHash.selector);
        registry.slashDoubleSign(sequencer1, blockNumber, blockHash, sig1, blockHash, sig2);
    }

    function test_slashDoubleSign_RejectsInvalidSignatures() public {
        uint256 blockNumber = 100;
        bytes32 blockHash1 = keccak256("block100v1");
        bytes32 blockHash2 = keccak256("block100v2");

        // Sign with wrong sequencer's key
        bytes memory sig1 = _signBlockProposal(sequencer1Key, blockNumber, blockHash1);
        bytes memory sig2 = _signBlockProposal(sequencer2Key, blockNumber, blockHash2);

        vm.prank(reporter);
        vm.expectRevert(SequencerRegistry.InvalidDoubleSignProof.selector);
        registry.slashDoubleSign(sequencer1, blockNumber, blockHash1, sig1, blockHash2, sig2);
    }

    function test_slashDoubleSign_Permissionless() public {
        uint256 blockNumber = 100;
        bytes32 blockHash1 = keccak256("block100v1");
        bytes32 blockHash2 = keccak256("block100v2");

        bytes memory sig1 = _signBlockProposal(sequencer1Key, blockNumber, blockHash1);
        bytes memory sig2 = _signBlockProposal(sequencer1Key, blockNumber, blockHash2);

        // Random address can call
        address randomCaller = address(0x999);
        vm.prank(randomCaller);
        registry.slashDoubleSign(sequencer1, blockNumber, blockHash1, sig1, blockHash2, sig2);

        (,,,,,,,,,, bool isSlashed) = registry.sequencers(sequencer1);
        assertTrue(isSlashed);
    }

    // =========================================================================
    // slashCensorship Tests
    // =========================================================================

    function test_slashCensorship_WithValidProof() public {
        // Queue a forced tx
        bytes memory txData = "forced transaction data";
        uint256 gasLimit = 100000;

        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        forcedInclusion.queueTx{value: 0.01 ether}(txData, gasLimit);

        // Get the txId (computed same way as ForcedInclusion)
        bytes32 txId = keccak256(abi.encodePacked(reporter, txData, gasLimit, block.number, block.timestamp));

        // Advance past inclusion window
        vm.roll(block.number + 51);

        // Now the tx can be force included, meaning window expired
        assertTrue(forcedInclusion.canForceInclude(txId));

        // Anyone can slash for censorship
        vm.prank(address(0x888));
        registry.slashCensorship(sequencer1, txId);

        // Verify slashing occurred (check stake reduced)
        (, uint256 stake,,,,,,,,,) = registry.sequencers(sequencer1);
        assertLt(stake, 1000 ether);
    }

    function test_slashCensorship_RevertsIfTxNotOverdue() public {
        // Queue a forced tx
        bytes memory txData = "forced transaction data";
        uint256 gasLimit = 100000;

        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        forcedInclusion.queueTx{value: 0.01 ether}(txData, gasLimit);

        bytes32 txId = keccak256(abi.encodePacked(reporter, txData, gasLimit, block.number, block.timestamp));

        // Don't advance past window
        vm.roll(block.number + 10);

        // Should revert because window hasn't expired
        vm.prank(address(0x888));
        vm.expectRevert(SequencerRegistry.TxNotOverdue.selector);
        registry.slashCensorship(sequencer1, txId);
    }

    function test_slashCensorship_RevertsIfForcedInclusionNotSet() public {
        // Deploy a new registry without forced inclusion
        vm.prank(owner);
        SequencerRegistry newRegistry = new SequencerRegistry(
            address(token), address(identityRegistry), address(reputationRegistry), treasury, owner
        );

        // Register sequencer1 on the new registry (reuse existing agent)
        vm.prank(sequencer1);
        token.approve(address(newRegistry), 2000 ether);
        vm.prank(sequencer1);
        newRegistry.register(agentId1, 1000 ether);

        // Try to slash - should revert because forcedInclusion is not set
        vm.expectRevert(SequencerRegistry.ForcedInclusionNotSet.selector);
        newRegistry.slashCensorship(sequencer1, bytes32(0));
    }

    // =========================================================================
    // slashDowntime Tests
    // =========================================================================

    function test_slashDowntime_Permissionless() public {
        // Create a range where sequencer hasn't produced any blocks
        uint256 startBlock = 1;
        uint256 endBlock = 150; // More than DOWNTIME_THRESHOLD (100)

        // Anyone can call
        vm.prank(reporter);
        registry.slashDowntime(sequencer1, startBlock, endBlock);

        // Verify slashing occurred
        (, uint256 stake,,,,,,,,,) = registry.sequencers(sequencer1);
        assertLt(stake, 1000 ether);
    }

    function test_slashDowntime_RevertsIfNoViolation() public {
        // First, have sequencer produce some blocks
        uint256 blockNumber = 50;
        bytes32 blockHash = keccak256("block50");
        bytes memory signature = _signBlockProposal(sequencer1Key, blockNumber, blockHash);

        vm.prank(sequencer1);
        registry.recordBlockProposed(blockNumber, blockHash, signature);

        // Try to slash for a range where they haven't missed enough
        uint256 startBlock = 45;
        uint256 endBlock = 55; // Only 10 blocks, less than threshold

        vm.prank(reporter);
        vm.expectRevert(SequencerRegistry.NoDowntimeViolation.selector);
        registry.slashDowntime(sequencer1, startBlock, endBlock);
    }

    function test_slashDowntime_RevertsForInactiveSequencer() public {
        // Unregister sequencer first
        vm.prank(sequencer1);
        registry.unregister();

        vm.prank(reporter);
        vm.expectRevert(SequencerRegistry.NotActive.selector);
        registry.slashDowntime(sequencer1, 1, 150);
    }

    // =========================================================================
    // Governance Functions (onlyOwner) Tests
    // =========================================================================

    function test_slashGovernanceBan_OnlyOwner() public {
        vm.prank(owner);
        registry.slashGovernanceBan(sequencer1);

        (,,,,,,,,,, bool isSlashed) = registry.sequencers(sequencer1);
        assertTrue(isSlashed);
    }

    function test_slashGovernanceBan_RevertsForNonOwner() public {
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", reporter));
        registry.slashGovernanceBan(sequencer1);
    }

    function test_setTreasury_OnlyOwner() public {
        address newTreasury = address(0x123);

        vm.prank(owner);
        registry.setTreasury(newTreasury);

        assertEq(registry.treasury(), newTreasury);
    }

    function test_setFeeConfig_OnlyOwner() public {
        address newFeeConfig = address(0x456);

        vm.prank(owner);
        registry.setFeeConfig(newFeeConfig);
    }

    function test_setSequencerRevenueShare_OnlyOwner() public {
        vm.prank(owner);
        registry.setSequencerRevenueShare(1000);

        assertEq(registry.sequencerRevenueShareBps(), 1000);
    }

    function test_pause_OnlyOwner() public {
        vm.prank(owner);
        registry.pause();

        assertTrue(registry.paused());
    }

    function test_unpause_OnlyOwner() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(owner);
        registry.unpause();

        assertFalse(registry.paused());
    }

    function test_setForcedInclusion_OnlyOwner() public {
        address newForcedInclusion = address(0x789);

        vm.prank(owner);
        registry.setForcedInclusion(newForcedInclusion);

        assertEq(address(registry.forcedInclusion()), newForcedInclusion);
    }

    // =========================================================================
    // Integration Tests
    // =========================================================================

    function test_multipleSequencersProposingBlocks() public {
        // All three sequencers propose different blocks
        for (uint256 i = 0; i < 10; i++) {
            uint256 blockNumber = 100 + i;

            if (i % 3 == 0) {
                bytes32 blockHash = keccak256(abi.encodePacked("seq1block", i));
                bytes memory sig = _signBlockProposal(sequencer1Key, blockNumber, blockHash);
                vm.prank(sequencer1);
                registry.recordBlockProposed(blockNumber, blockHash, sig);
            } else if (i % 3 == 1) {
                bytes32 blockHash = keccak256(abi.encodePacked("seq2block", i));
                bytes memory sig = _signBlockProposal(sequencer2Key, blockNumber, blockHash);
                vm.prank(sequencer2);
                registry.recordBlockProposed(blockNumber, blockHash, sig);
            } else {
                bytes32 blockHash = keccak256(abi.encodePacked("seq3block", i));
                bytes memory sig = _signBlockProposal(sequencer3Key, blockNumber, blockHash);
                vm.prank(sequencer3);
                registry.recordBlockProposed(blockNumber, blockHash, sig);
            }
        }

        // Verify block counts
        (,,,,, uint256 blocks1,,,,,) = registry.sequencers(sequencer1);
        (,,,,, uint256 blocks2,,,,,) = registry.sequencers(sequencer2);
        (,,,,, uint256 blocks3,,,,,) = registry.sequencers(sequencer3);

        assertEq(blocks1, 4); // indices 0, 3, 6, 9
        assertEq(blocks2, 3); // indices 1, 4, 7
        assertEq(blocks3, 3); // indices 2, 5, 8
    }

    function test_slashedSequencerCannotProposeBlocks() public {
        // Slash sequencer1
        vm.prank(owner);
        registry.slashGovernanceBan(sequencer1);

        // Try to propose block
        uint256 blockNumber = 100;
        bytes32 blockHash = keccak256("block100");
        bytes memory sig = _signBlockProposal(sequencer1Key, blockNumber, blockHash);

        vm.prank(sequencer1);
        vm.expectRevert(SequencerRegistry.NotActiveSequencer.selector);
        registry.recordBlockProposed(blockNumber, blockHash, sig);
    }
}
