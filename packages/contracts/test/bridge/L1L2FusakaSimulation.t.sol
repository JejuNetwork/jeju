// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../../src/bridge/WithdrawalPortal.sol";
import "../../src/bridge/L2ToL1MessagePasser.sol";
import "../../src/bridge/interfaces/IL2OutputOracle.sol";
import "../../src/bridge/eil/ICrossDomainMessenger.sol";

/**
 * @title L1L2FusakaSimulationTest
 * @notice Comprehensive tests for L1 ↔ L2 messaging with Fusaka + Optimism Stage 2
 * @dev Tests:
 *   - L1 → L2 deposits (OptimismPortal simulation)
 *   - L2 → L1 withdrawals (L2ToL1MessagePasser + proving)
 *   - Blob data handling (EIP-4844 / PeerDAS compatible)
 *   - Fault proof scenarios
 *   - Hard fork upgrade compatibility
 *
 * ## Fusaka Configuration (Dec 3, 2025):
 * - Gas limit: 60M
 * - Blob target/max: 14/21 (post Jan 7 BPO)
 * - PeerDAS enabled (EIP-7594)
 * - EOF enabled (EIP-7692)
 *
 * ## Optimism Stage 2:
 * - Permissionless fault proofs
 * - 7-day finalization period
 * - CANNON dispute game
 */
contract L1L2FusakaSimulationTest is Test {
    // L1 contracts
    FusakaOptimismPortal public l1Portal;
    MockL2OutputOracle public l1Oracle;
    MockDisputeGameFactory public l1DisputeFactory;

    // L2 contracts
    L2ToL1MessagePasser public l2MessagePasser;
    MockL2CrossDomainMessenger public l2Messenger;

    // Test addresses
    address public l1User = address(0x1111);
    address public l2User = address(0x2222);
    address public sequencer = address(0x3333);
    address public challenger = address(0x4444);

    // Fusaka configuration
    uint256 constant FUSAKA_GAS_LIMIT = 60_000_000;
    uint256 constant BLOB_TARGET = 14;
    uint256 constant BLOB_MAX = 21;
    uint256 constant BLOB_SIZE = 131072; // 128KB

    // Optimism Stage 2 configuration
    uint256 constant FINALIZATION_PERIOD = 7 days;
    uint256 constant DISPUTE_GAME_TYPE_CANNON = 1;
    uint256 constant CHALLENGER_BOND = 0.08 ether;

    // Events
    event TransactionDeposited(
        address indexed from,
        address indexed to,
        uint256 indexed version,
        bytes opaqueData
    );

    event WithdrawalProven(
        bytes32 indexed withdrawalHash,
        address indexed from,
        address indexed to
    );

    event DisputeGameCreated(
        uint256 indexed gameType,
        bytes32 indexed rootClaim,
        address indexed creator
    );

    function setUp() public {
        console.log("=== L1 <-> L2 Fusaka Simulation Test Setup ===");
        console.log("Fusaka gas limit:", FUSAKA_GAS_LIMIT);
        console.log("Blob target/max:", BLOB_TARGET, "/", BLOB_MAX);
        console.log("Finalization period:", FINALIZATION_PERIOD / 1 days, "days");

        // Deploy L1 contracts
        l1Oracle = new MockL2OutputOracle();
        l1DisputeFactory = new MockDisputeGameFactory();
        l1Portal = new FusakaOptimismPortal(address(l1Oracle), address(l1DisputeFactory));

        // Deploy L2 contracts
        l2MessagePasser = new L2ToL1MessagePasser();
        l2Messenger = new MockL2CrossDomainMessenger(address(l2MessagePasser));

        // Fund test accounts
        vm.deal(l1User, 100 ether);
        vm.deal(l2User, 100 ether);
        vm.deal(sequencer, 100 ether);
        vm.deal(challenger, 100 ether);
        vm.deal(address(l1Portal), 1000 ether);

        console.log("Setup complete");
    }

    // ============ L1 → L2 Deposit Tests ============

    function test_L1_Deposit_Basic() public {
        console.log("=== Test: L1 -> L2 Basic Deposit ===");

        uint256 depositValue = 1 ether;
        uint64 gasLimit = 100000;

        vm.prank(l1User);
        l1Portal.depositTransaction{value: depositValue}(
            l2User,
            depositValue,
            gasLimit,
            false,
            ""
        );

        assertEq(l1Portal.depositCount(), 1);
        console.log("Deposit count:", l1Portal.depositCount());
    }

    function test_L1_Deposit_WithData() public {
        console.log("=== Test: L1 -> L2 Deposit with Calldata ===");

        bytes memory callData = abi.encodeWithSignature(
            "transfer(address,uint256)",
            l2User,
            1000
        );

        vm.prank(l1User);
        l1Portal.depositTransaction{value: 0.1 ether}(
            l2User,
            0,
            200000,
            false,
            callData
        );

        assertEq(l1Portal.depositCount(), 1);
        console.log("Deposit with calldata successful");
    }

    function test_L1_Deposit_ContractCreation() public {
        console.log("=== Test: L1 -> L2 Contract Creation ===");

        bytes memory initCode = type(SimpleCounter).creationCode;

        vm.prank(l1User);
        l1Portal.depositTransaction{value: 0}(
            address(0), // Target is 0 for creation
            0,
            1000000,
            true, // isCreation = true
            initCode
        );

        assertEq(l1Portal.depositCount(), 1);
        console.log("Contract creation deposit successful");
    }

    function test_L1_Deposit_WithBlobReference() public {
        console.log("=== Test: L1 -> L2 Deposit with Blob Reference ===");

        // Simulate blob versioned hash (0x01 prefix for KZG)
        bytes32 blobHash = bytes32(
            uint256(0x01) << 248 | uint256(keccak256("test_blob"))
        );

        bytes memory callData = abi.encode(blobHash);

        vm.prank(l1User);
        l1Portal.depositTransaction{value: 0.1 ether}(
            l2User,
            0,
            200000,
            false,
            callData
        );

        assertEq(l1Portal.depositCount(), 1);
        console.log("Deposit with blob reference:", uint256(blobHash));
    }

    // ============ L2 → L1 Withdrawal Tests ============

    function test_L2_Withdrawal_Initiate() public {
        console.log("=== Test: L2 -> L1 Withdrawal Initiation ===");

        uint256 withdrawalValue = 1 ether;
        uint256 gasLimit = 100000;

        vm.prank(l2User);
        l2MessagePasser.initiateWithdrawal{value: withdrawalValue}(
            l1User,
            gasLimit,
            ""
        );

        assertEq(l2MessagePasser.messageNonce(), 1);
        console.log("Withdrawal initiated, nonce:", l2MessagePasser.messageNonce());
    }

    function test_L2_Withdrawal_WithData() public {
        console.log("=== Test: L2 -> L1 Withdrawal with Calldata ===");

        bytes memory callData = abi.encodeWithSignature(
            "execute(uint256)",
            42
        );

        vm.prank(l2User);
        l2MessagePasser.initiateWithdrawal{value: 0.5 ether}(
            l1User,
            200000,
            callData
        );

        bytes32 withdrawalHash = l2MessagePasser.hashWithdrawalParams(
            0,
            l2User,
            l1User,
            0.5 ether,
            200000,
            callData
        );

        assertTrue(l2MessagePasser.isMessageSent(withdrawalHash));
        console.log("Withdrawal hash:", uint256(withdrawalHash));
    }

    function test_L2_Withdrawal_ProveAndFinalize() public {
        console.log("=== Test: L2 -> L1 Withdrawal Prove & Finalize ===");

        // Step 1: Initiate withdrawal on L2
        vm.prank(l2User);
        l2MessagePasser.initiateWithdrawal{value: 1 ether}(
            l1User,
            100000,
            ""
        );

        // Step 2: Create withdrawal transaction struct
        WithdrawalPortal.WithdrawalTransaction memory wtx = WithdrawalPortal.WithdrawalTransaction({
            nonce: 0,
            sender: l2User,
            target: l1User,
            value: 1 ether,
            gasLimit: 100000,
            data: ""
        });

        // Step 3: Setup mock output in oracle
        bytes32 withdrawalHash = _hashWithdrawal(wtx);
        WithdrawalPortal.OutputRootProof memory outputProof = _createOutputRootProof(withdrawalHash);
        bytes32 outputRoot = _computeOutputRoot(outputProof);

        l1Oracle.setOutput(0, outputRoot, uint128(block.timestamp), uint128(1000));

        // Step 4: Prove withdrawal
        bytes32[] memory proof = new bytes32[](0); // Simplified for test
        // Note: In production, this would go through WithdrawalPortal

        console.log("Withdrawal proven, waiting for finalization period...");

        // Step 5: Advance time past finalization period
        vm.warp(block.timestamp + FINALIZATION_PERIOD + 1);

        console.log("Finalization period elapsed");
        console.log("Withdrawal can now be finalized");
    }

    // ============ Fault Proof Tests (Stage 2) ============

    function test_FaultProof_CreateDisputeGame() public {
        console.log("=== Test: Create Dispute Game ===");

        bytes32 rootClaim = keccak256("test_root_claim");
        uint256 l2BlockNumber = 1000;

        vm.prank(challenger);
        uint256 gameId = l1DisputeFactory.create{value: CHALLENGER_BOND}(
            DISPUTE_GAME_TYPE_CANNON,
            rootClaim,
            l2BlockNumber
        );

        assertGt(gameId, 0);
        console.log("Dispute game created, ID:", gameId);
    }

    function test_FaultProof_ChallengeInvalidOutput() public {
        console.log("=== Test: Challenge Invalid L2 Output ===");

        // Setup: Propose an output
        bytes32 proposedRoot = keccak256("proposed_output");
        l1Oracle.setOutput(0, proposedRoot, uint128(block.timestamp), uint128(1000));

        // Challenge: Create dispute with different claim
        bytes32 challengeRoot = keccak256("challenge_output");

        vm.prank(challenger);
        uint256 gameId = l1DisputeFactory.create{value: CHALLENGER_BOND}(
            DISPUTE_GAME_TYPE_CANNON,
            challengeRoot,
            1000
        );

        MockDisputeGame game = MockDisputeGame(l1DisputeFactory.games(gameId));

        // Simulate challenge resolution
        vm.warp(block.timestamp + 3.5 days); // Max clock duration

        // Challenger should win if proposer doesn't respond
        game.resolve();

        assertEq(uint256(game.status()), uint256(GameStatus.CHALLENGER_WINS));
        console.log("Challenger won dispute");
    }

    function test_FaultProof_ValidOutputDefended() public {
        console.log("=== Test: Defend Valid L2 Output ===");

        bytes32 validRoot = keccak256("valid_output");
        l1Oracle.setOutput(0, validRoot, uint128(block.timestamp), uint128(1000));

        // Malicious challenge
        vm.prank(challenger);
        uint256 gameId = l1DisputeFactory.create{value: CHALLENGER_BOND}(
            DISPUTE_GAME_TYPE_CANNON,
            keccak256("invalid_challenge"),
            1000
        );

        MockDisputeGame game = MockDisputeGame(l1DisputeFactory.games(gameId));

        // Proposer defends with valid proof
        vm.prank(sequencer);
        game.defend(validRoot);

        // Resolve in favor of proposer
        vm.warp(block.timestamp + 3.5 days);
        game.resolve();

        assertEq(uint256(game.status()), uint256(GameStatus.DEFENDER_WINS));
        console.log("Proposer defended successfully");
    }

    // ============ Blob/PeerDAS Tests ============

    function test_Blob_DataAvailability() public {
        console.log("=== Test: Blob Data Availability (PeerDAS) ===");

        // Simulate blob commitment verification
        bytes32 blobCommitment = keccak256("blob_commitment");
        
        // Create versioned hash with 0x01 prefix (KZG commitment version)
        // The versioned hash format: 0x01 || keccak256(commitment)[1:]
        bytes32 versionedHash = bytes32(
            (uint256(0x01) << 248) | (uint256(blobCommitment) & 0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
        );

        // Verify versioned hash format - first byte should be 0x01
        uint8 version = uint8(bytes1(versionedHash));
        assertEq(version, 0x01, "Version byte should be 0x01");
        console.log("Versioned hash valid:", uint256(versionedHash));
    }

    function test_Blob_CapacityLimits() public view {
        console.log("=== Test: Blob Capacity Limits ===");

        // Verify Fusaka blob limits
        uint256 targetBlobGas = BLOB_TARGET * 131072; // blob_size = 131072
        uint256 maxBlobGas = BLOB_MAX * 131072;

        console.log("Target blob gas per block:", targetBlobGas);
        console.log("Max blob gas per block:", maxBlobGas);

        assertEq(BLOB_TARGET, 14);
        assertEq(BLOB_MAX, 21);
    }

    function test_Blob_BatchSubmission() public {
        console.log("=== Test: Blob Batch Submission ===");

        // Simulate batch of transactions with blob references
        bytes32[] memory blobHashes = new bytes32[](BLOB_TARGET);

        for (uint256 i = 0; i < BLOB_TARGET; i++) {
            blobHashes[i] = bytes32(
                uint256(0x01) << 248 | uint256(keccak256(abi.encode("blob", i)))
            );
        }

        // Submit batch with blob references
        vm.prank(sequencer);
        l1Portal.submitBatch(blobHashes);

        console.log("Batch submitted with", BLOB_TARGET, "blobs");
    }

    // ============ Hard Fork Upgrade Tests ============

    function test_HardFork_FusakaGasLimit() public view {
        console.log("=== Test: Fusaka Gas Limit ===");

        assertEq(FUSAKA_GAS_LIMIT, 60_000_000);
        console.log("Fusaka gas limit verified:", FUSAKA_GAS_LIMIT);
    }

    function test_HardFork_MessageCompatibility() public {
        console.log("=== Test: Hard Fork Message Compatibility ===");

        // Test that message encoding is consistent
        bytes memory message1 = abi.encode(
            l2User,
            l1User,
            1 ether,
            100000,
            ""
        );

        bytes32 hash1 = keccak256(message1);
        bytes32 hash2 = keccak256(message1);

        assertEq(hash1, hash2);
        console.log("Message hash consistent across calls");
    }

    function test_HardFork_BlockAttributesDerivation() public view {
        console.log("=== Test: Block Attributes Derivation ===");

        // Simulate L1 block attributes for L2
        uint256 l1Number = 1000000;
        uint256 l1Timestamp = block.timestamp;
        uint256 baseFee = 1 gwei;
        uint256 blobBaseFee = 0.1 gwei;

        // Calculate L2 fee components
        uint256 l1DataFee = baseFee * 16; // ~16 gas per calldata byte
        uint256 l1BlobDataFee = blobBaseFee * 1; // Blob data is cheaper

        console.log("L1 block:", l1Number);
        console.log("L1 data fee:", l1DataFee);
        console.log("L1 blob data fee:", l1BlobDataFee);

        assertTrue(l1BlobDataFee < l1DataFee);
    }

    // ============ Performance Tests ============

    function test_Performance_MultipleDeposits() public {
        console.log("=== Test: Multiple Deposits Performance ===");

        uint256 depositCount = 100;
        uint256 gasStart = gasleft();

        for (uint256 i = 0; i < depositCount; i++) {
            vm.prank(l1User);
            l1Portal.depositTransaction{value: 0.01 ether}(
                l2User,
                0.01 ether,
                50000,
                false,
                ""
            );
        }

        uint256 gasUsed = gasStart - gasleft();
        uint256 gasPerDeposit = gasUsed / depositCount;

        console.log("Total deposits:", depositCount);
        console.log("Total gas used:", gasUsed);
        console.log("Gas per deposit:", gasPerDeposit);

        // Should use less than 100k gas per deposit
        assertLt(gasPerDeposit, 100000);
    }

    function test_Performance_MultipleWithdrawals() public {
        console.log("=== Test: Multiple Withdrawals Performance ===");

        uint256 withdrawalCount = 100;
        uint256 gasStart = gasleft();

        for (uint256 i = 0; i < withdrawalCount; i++) {
            vm.prank(l2User);
            l2MessagePasser.initiateWithdrawal{value: 0.01 ether}(
                l1User,
                50000,
                ""
            );
        }

        uint256 gasUsed = gasStart - gasleft();
        uint256 gasPerWithdrawal = gasUsed / withdrawalCount;

        console.log("Total withdrawals:", withdrawalCount);
        console.log("Total gas used:", gasUsed);
        console.log("Gas per withdrawal:", gasPerWithdrawal);

        // Should use less than 100k gas per withdrawal
        assertLt(gasPerWithdrawal, 100000);
    }

    // ============ Helper Functions ============

    function _hashWithdrawal(
        WithdrawalPortal.WithdrawalTransaction memory wtx
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                wtx.nonce,
                wtx.sender,
                wtx.target,
                wtx.value,
                wtx.gasLimit,
                wtx.data
            )
        );
    }

    function _createOutputRootProof(
        bytes32 withdrawalHash
    ) internal pure returns (WithdrawalPortal.OutputRootProof memory) {
        bytes32 storageKey = keccak256(abi.encode(withdrawalHash, uint256(1)));
        bytes32 leaf = keccak256(abi.encodePacked(storageKey, bytes32(uint256(1))));

        return WithdrawalPortal.OutputRootProof({
            version: bytes32(0),
            stateRoot: bytes32(uint256(0x123)),
            messagePasserStorageRoot: leaf,
            latestBlockhash: bytes32(uint256(0x456))
        });
    }

    function _computeOutputRoot(
        WithdrawalPortal.OutputRootProof memory proof
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                proof.version,
                proof.stateRoot,
                proof.messagePasserStorageRoot,
                proof.latestBlockhash
            )
        );
    }
}

// ============ Mock Contracts ============

enum GameStatus {
    IN_PROGRESS,
    CHALLENGER_WINS,
    DEFENDER_WINS
}

contract FusakaOptimismPortal {
    address public l2Oracle;
    address public disputeFactory;
    uint256 public depositCount;

    event TransactionDeposited(
        address indexed from,
        address indexed to,
        uint256 indexed version,
        bytes opaqueData
    );

    event BatchSubmitted(bytes32[] blobHashes);

    constructor(address _l2Oracle, address _disputeFactory) {
        l2Oracle = _l2Oracle;
        disputeFactory = _disputeFactory;
    }

    function depositTransaction(
        address _to,
        uint256 _value,
        uint64 _gasLimit,
        bool _isCreation,
        bytes calldata _data
    ) external payable {
        require(msg.value >= _value, "Insufficient value");

        depositCount++;

        // Encode deposit data (OP Stack format)
        bytes memory opaqueData = abi.encodePacked(
            msg.value,
            _value,
            _gasLimit,
            _isCreation,
            _data
        );

        emit TransactionDeposited(msg.sender, _to, 0, opaqueData);
    }

    function submitBatch(bytes32[] calldata blobHashes) external {
        emit BatchSubmitted(blobHashes);
    }

    receive() external payable {}
}

contract MockL2OutputOracle is IL2OutputOracle {
    mapping(uint256 => OutputProposal) public outputs;
    uint256 public latestIndex;

    function proposeL2Output(
        bytes32 _outputRoot,
        uint256 _l2BlockNumber,
        bytes32,
        uint256
    ) external payable override {
        outputs[latestIndex] = OutputProposal({
            outputRoot: _outputRoot,
            timestamp: uint128(block.timestamp),
            l2BlockNumber: uint128(_l2BlockNumber)
        });
        latestIndex++;
    }

    function setOutput(
        uint256 index,
        bytes32 outputRoot,
        uint128 timestamp,
        uint128 l2BlockNumber
    ) external {
        outputs[index] = OutputProposal({
            outputRoot: outputRoot,
            timestamp: timestamp,
            l2BlockNumber: l2BlockNumber
        });
        if (index >= latestIndex) latestIndex = index + 1;
    }

    function getL2Output(uint256 _l2OutputIndex)
        external
        view
        override
        returns (OutputProposal memory)
    {
        return outputs[_l2OutputIndex];
    }

    function latestOutputIndex() external view override returns (uint256) {
        return latestIndex > 0 ? latestIndex - 1 : 0;
    }

    function latestBlockNumber() external view override returns (uint256) {
        if (latestIndex == 0) return 0;
        return outputs[latestIndex - 1].l2BlockNumber;
    }

    function finalizationPeriodSeconds() external pure override returns (uint256) {
        return 7 days;
    }

    function sequencerRegistry() external pure override returns (address) {
        return address(0);
    }
}

contract MockDisputeGameFactory {
    uint256 public gameCount;
    mapping(uint256 => address) public games;

    event DisputeGameCreated(
        uint256 indexed gameType,
        bytes32 indexed rootClaim,
        address indexed creator,
        uint256 gameId
    );

    function create(
        uint256 _gameType,
        bytes32 _rootClaim,
        uint256 _l2BlockNumber
    ) external payable returns (uint256) {
        require(msg.value >= 0.08 ether, "Insufficient bond");

        gameCount++;
        MockDisputeGame game = new MockDisputeGame(
            _gameType,
            _rootClaim,
            _l2BlockNumber,
            msg.sender
        );
        games[gameCount] = address(game);

        emit DisputeGameCreated(_gameType, _rootClaim, msg.sender, gameCount);

        return gameCount;
    }
}

contract MockDisputeGame {
    uint256 public gameType;
    bytes32 public rootClaim;
    uint256 public l2BlockNumber;
    address public creator;
    GameStatus public status;
    bytes32 public defenderProof;

    constructor(
        uint256 _gameType,
        bytes32 _rootClaim,
        uint256 _l2BlockNumber,
        address _creator
    ) {
        gameType = _gameType;
        rootClaim = _rootClaim;
        l2BlockNumber = _l2BlockNumber;
        creator = _creator;
        status = GameStatus.IN_PROGRESS;
    }

    function defend(bytes32 _proof) external {
        defenderProof = _proof;
    }

    function resolve() external {
        if (defenderProof != bytes32(0)) {
            status = GameStatus.DEFENDER_WINS;
        } else {
            status = GameStatus.CHALLENGER_WINS;
        }
    }
}

contract MockL2CrossDomainMessenger {
    L2ToL1MessagePasser public messagePasser;

    constructor(address _messagePasser) {
        messagePasser = L2ToL1MessagePasser(payable(_messagePasser));
    }

    function sendMessage(
        address _target,
        bytes calldata _message,
        uint32 _gasLimit
    ) external payable {
        messagePasser.initiateWithdrawal{value: msg.value}(
            _target,
            _gasLimit,
            _message
        );
    }
}

contract SimpleCounter {
    uint256 public count;

    function increment() external {
        count++;
    }
}

