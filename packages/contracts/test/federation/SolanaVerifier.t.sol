// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {SolanaVerifier} from "../../src/federation/SolanaVerifier.sol";
import {IWormhole} from "../../src/federation/interfaces/IWormhole.sol";

/**
 * @title MockWormhole
 * @notice Mock Wormhole contract for testing VAA verification
 */
contract MockWormhole {
    bool public shouldFail;
    string public failReason;
    uint16 public mockChainId;
    bytes32 public mockEmitter;
    uint64 public mockSequence;
    bytes public mockPayload;

    function setMockData(uint16 chainId, bytes32 emitter, uint64 sequence, bytes memory payload) external {
        mockChainId = chainId;
        mockEmitter = emitter;
        mockSequence = sequence;
        mockPayload = payload;
        shouldFail = false;
    }

    function setShouldFail(bool _shouldFail, string memory _reason) external {
        shouldFail = _shouldFail;
        failReason = _reason;
    }

    function parseAndVerifyVM(bytes calldata)
        external
        view
        returns (IWormhole.VM memory vm, bool valid, string memory reason)
    {
        if (shouldFail) {
            return (vm, false, failReason);
        }

        vm.version = 1;
        vm.timestamp = uint32(block.timestamp);
        vm.nonce = 0;
        vm.emitterChainId = mockChainId;
        vm.emitterAddress = mockEmitter;
        vm.sequence = mockSequence;
        vm.consistencyLevel = 1;
        vm.payload = mockPayload;
        vm.guardianSetIndex = 0;
        vm.hash = keccak256(mockPayload);

        return (vm, true, "");
    }
}

/**
 * @title SolanaVerifierTest
 * @notice Tests for Solana SPL/SPL-2022 registry verification via Wormhole
 *
 * Tests cover:
 * - Manual entry verification (owner)
 * - Entry queries by type
 * - SPL-2022 (ai16z style) token tracking
 * - Wormhole integration (mocked)
 */
contract SolanaVerifierTest is Test {
    SolanaVerifier verifier;
    MockWormhole mockWormhole;

    address owner;
    bytes32 trustedEmitter;

    bytes32 constant MOCK_MINT_1 = bytes32(uint256(0x1111111111111111));
    bytes32 constant MOCK_MINT_2 = bytes32(uint256(0x2222222222222222));
    bytes32 constant MOCK_MINT_3 = bytes32(uint256(0x3333333333333333));
    bytes32 constant MOCK_AUTHORITY = bytes32(uint256(0xAAAAAAAAAAAAAA));

    function setUp() public {
        owner = makeAddr("owner");
        trustedEmitter = keccak256("trusted-emitter");

        // Deploy mock wormhole
        mockWormhole = new MockWormhole();

        vm.startPrank(owner);
        verifier = new SolanaVerifier(address(mockWormhole), trustedEmitter);
        vm.stopPrank();
    }

    // ============ Manual Entry Tests ============

    function test_AddVerifiedEntry() public {
        vm.startPrank(owner);
        verifier.addVerifiedEntry(
            MOCK_MINT_1,
            MOCK_AUTHORITY,
            "AI16Z Token",
            "AI16Z",
            "https://arweave.net/metadata",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022,
            1000000000 * 10 ** 9, // 1B tokens
            9
        );
        vm.stopPrank();

        // Verify entry
        assertTrue(verifier.isVerified(MOCK_MINT_1));
        assertEq(verifier.totalEntries(), 1);
        assertEq(verifier.countByType(SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022), 1);

        // Get full entry
        SolanaVerifier.SolanaEntry memory entry = verifier.getEntry(MOCK_MINT_1);
        assertEq(entry.mint, MOCK_MINT_1);
        assertEq(entry.authority, MOCK_AUTHORITY);
        assertEq(entry.name, "AI16Z Token");
        assertEq(entry.symbol, "AI16Z");
        assertEq(entry.decimals, 9);
        assertTrue(entry.verified);
    }

    function test_AddMultipleEntries() public {
        vm.startPrank(owner);

        // SPL Token (classic)
        verifier.addVerifiedEntry(
            MOCK_MINT_1,
            MOCK_AUTHORITY,
            "Classic Token",
            "CLASSIC",
            "https://arweave.net/1",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN,
            1000000 * 10 ** 6,
            6
        );

        // SPL Token 2022 (ai16z style)
        verifier.addVerifiedEntry(
            MOCK_MINT_2,
            MOCK_AUTHORITY,
            "AI16Z Token",
            "AI16Z",
            "https://arweave.net/2",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022,
            1000000000 * 10 ** 9,
            9
        );

        // Custom registry (daos.fun style)
        verifier.addVerifiedEntry(
            MOCK_MINT_3,
            MOCK_AUTHORITY,
            "DAO Token",
            "DAO",
            "https://arweave.net/3",
            SolanaVerifier.SolanaProgramType.CUSTOM_REGISTRY,
            500000000 * 10 ** 9,
            9
        );

        vm.stopPrank();

        assertEq(verifier.totalEntries(), 3);
        assertEq(verifier.countByType(SolanaVerifier.SolanaProgramType.SPL_TOKEN), 1);
        assertEq(verifier.countByType(SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022), 1);
        assertEq(verifier.countByType(SolanaVerifier.SolanaProgramType.CUSTOM_REGISTRY), 1);
    }

    // ============ Query Tests ============

    function test_GetMintsByType() public {
        _setupMultipleEntries();

        // Get SPL-2022 tokens
        bytes32[] memory spl2022 = verifier.getMintsByType(SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022);
        assertEq(spl2022.length, 1);
        assertEq(spl2022[0], MOCK_MINT_2);

        // Get classic SPL tokens
        bytes32[] memory classic = verifier.getMintsByType(SolanaVerifier.SolanaProgramType.SPL_TOKEN);
        assertEq(classic.length, 1);
        assertEq(classic[0], MOCK_MINT_1);
    }

    function test_GetSPL2022Tokens() public {
        _setupMultipleEntries();

        bytes32[] memory spl2022 = verifier.getSPL2022Tokens();
        assertEq(spl2022.length, 1);
        assertEq(spl2022[0], MOCK_MINT_2);
    }

    function test_GetAllVerifiedMints() public {
        _setupMultipleEntries();

        bytes32[] memory all = verifier.getAllVerifiedMints();
        assertEq(all.length, 3);
    }

    function test_IsVerified() public {
        assertFalse(verifier.isVerified(MOCK_MINT_1));

        vm.prank(owner);
        verifier.addVerifiedEntry(
            MOCK_MINT_1, MOCK_AUTHORITY, "Test", "TEST", "", SolanaVerifier.SolanaProgramType.SPL_TOKEN, 1000, 6
        );

        assertTrue(verifier.isVerified(MOCK_MINT_1));
        assertFalse(verifier.isVerified(MOCK_MINT_2));
    }

    // ============ Admin Tests ============

    function test_SetTrustedEmitter() public {
        bytes32 newEmitter = keccak256("new-emitter");

        vm.prank(owner);
        verifier.setTrustedEmitter(newEmitter);

        assertEq(verifier.trustedEmitter(), newEmitter);
    }

    function test_SetWormhole() public {
        address newWormhole = makeAddr("newWormhole");

        vm.prank(owner);
        verifier.setWormhole(newWormhole);

        assertEq(address(verifier.wormhole()), newWormhole);
    }

    function test_RevertWhen_NonOwnerAddsEntry() public {
        address notOwner = makeAddr("notOwner");

        vm.prank(notOwner);
        vm.expectRevert();
        verifier.addVerifiedEntry(
            MOCK_MINT_1, MOCK_AUTHORITY, "Test", "TEST", "", SolanaVerifier.SolanaProgramType.SPL_TOKEN, 1000, 6
        );
    }

    // ============ Wormhole VAA Tests ============

    function test_VerifyEntry_RevertOnInvalidVAA() public {
        // Set mock to return invalid (fail verification)
        mockWormhole.setShouldFail(true, "VAA verification failed");

        bytes memory mockVaa = hex"0000";

        vm.expectRevert(SolanaVerifier.VerificationFailed.selector);
        verifier.verifyEntry(mockVaa);
    }

    function test_VerifyEntry_RevertOnWrongChain() public {
        // Set mock to return a valid VAA but with wrong chain ID
        mockWormhole.setMockData(
            2, // Ethereum chain ID instead of Solana (1)
            trustedEmitter,
            1,
            new bytes(100)
        );

        bytes memory mockVaa = hex"0000";

        vm.expectRevert(SolanaVerifier.InvalidChainId.selector);
        verifier.verifyEntry(mockVaa);
    }

    function test_VerifyEntry_RevertOnWrongEmitter() public {
        bytes32 wrongEmitter = keccak256("wrong-emitter");

        // Set mock to return a valid VAA but with wrong emitter
        mockWormhole.setMockData(
            1, // Solana chain ID
            wrongEmitter,
            1,
            new bytes(100)
        );

        bytes memory mockVaa = hex"0000";

        vm.expectRevert(SolanaVerifier.InvalidEmitter.selector);
        verifier.verifyEntry(mockVaa);
    }

    // ============ Constants Tests ============

    function test_Constants() public view {
        assertEq(verifier.WORMHOLE_SOLANA_CHAIN_ID(), 1);
        assertEq(verifier.SPL_TOKEN_PROGRAM(), 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
    }

    function test_Version() public view {
        assertEq(verifier.version(), "1.0.0");
    }

    // ============ Helpers ============

    function _setupMultipleEntries() internal {
        vm.startPrank(owner);

        verifier.addVerifiedEntry(
            MOCK_MINT_1,
            MOCK_AUTHORITY,
            "Classic Token",
            "CLASSIC",
            "",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN,
            1000,
            6
        );

        verifier.addVerifiedEntry(
            MOCK_MINT_2,
            MOCK_AUTHORITY,
            "AI16Z Token",
            "AI16Z",
            "",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022,
            1000,
            9
        );

        verifier.addVerifiedEntry(
            MOCK_MINT_3,
            MOCK_AUTHORITY,
            "DAO Token",
            "DAO",
            "",
            SolanaVerifier.SolanaProgramType.CUSTOM_REGISTRY,
            1000,
            9
        );

        vm.stopPrank();
    }
}
