// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../src/bridge/WithdrawalPortal.sol";
import "../src/bridge/L2ToL1MessagePasser.sol";
import "../src/bridge/interfaces/IL2OutputOracle.sol";

/**
 * @title DeployL1OpStack
 * @notice Deploy the L1 OP Stack contracts for local development
 * @dev This deploys:
 *   - L2OutputOracle (mock for localnet, real for testnet/mainnet)
 *   - OptimismPortal (or WithdrawalPortal as compatible implementation)
 *   - SystemConfig (configuration for the rollup)
 *
 * Usage:
 *   # Deploy to local L1 (Anvil)
 *   forge script script/DeployL1OpStack.s.sol:DeployL1OpStack \
 *     --rpc-url http://127.0.0.1:8545 --broadcast --legacy
 *
 *   # Deploy to Sepolia L1
 *   forge script script/DeployL1OpStack.s.sol:DeployL1OpStack \
 *     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
 */
contract DeployL1OpStack is Script {
    // Default addresses for the rollup
    address constant BATCHER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant PROPOSER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant CHALLENGER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    // L2 chain configuration
    uint256 constant L2_CHAIN_ID = 901;
    uint64 constant L2_BLOCK_TIME = 2;
    uint64 constant MAX_SEQUENCER_DRIFT = 600;
    uint64 constant SEQ_WINDOW_SIZE = 3600;

    function run() public {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy L2OutputOracle (stores proposed L2 state roots)
        L2OutputOracleImpl oracle = new L2OutputOracleImpl(
            L2_BLOCK_TIME,
            block.number,  // Starting L1 block
            block.timestamp,
            PROPOSER,
            CHALLENGER
        );
        console.log("L2OutputOracle deployed:", address(oracle));

        // 2. Deploy OptimismPortal (handles deposits and withdrawal finalization)
        OptimismPortalImpl portal = new OptimismPortalImpl(address(oracle));
        console.log("OptimismPortal deployed:", address(portal));

        // 3. Deploy SystemConfig (rollup configuration)
        SystemConfigImpl systemConfig = new SystemConfigImpl(
            deployer,          // owner
            BATCHER,           // batcher
            uint64(30_000_000), // gas limit
            address(0),        // unsafe block signer
            bytes32(0),        // batch inbox (derived)
            address(portal)    // portal address
        );
        console.log("SystemConfig deployed:", address(systemConfig));

        // 4. Deploy L1CrossDomainMessenger
        L1CrossDomainMessengerImpl messenger = new L1CrossDomainMessengerImpl(
            address(portal)
        );
        console.log("L1CrossDomainMessenger deployed:", address(messenger));

        // 5. Deploy L1StandardBridge
        L1StandardBridgeImpl bridge = new L1StandardBridgeImpl(
            payable(address(messenger))
        );
        console.log("L1StandardBridge deployed:", address(bridge));

        vm.stopBroadcast();

        // Output deployment summary
        console.log("");
        console.log("=== L1 OP Stack Deployment Summary ===");
        console.log("L2OutputOracle:          ", address(oracle));
        console.log("OptimismPortal:          ", address(portal));
        console.log("SystemConfig:            ", address(systemConfig));
        console.log("L1CrossDomainMessenger:  ", address(messenger));
        console.log("L1StandardBridge:        ", address(bridge));
        console.log("");
        console.log("Proposer:                ", PROPOSER);
        console.log("Batcher:                 ", BATCHER);
        console.log("Challenger:              ", CHALLENGER);
    }
}

/**
 * @title L2OutputOracleImpl
 * @notice Simplified L2 Output Oracle for local development
 */
contract L2OutputOracleImpl is IL2OutputOracle {
    uint256 public immutable l2BlockTime;
    uint256 public immutable startingBlockNumber;
    uint256 public immutable startingTimestamp;
    address public immutable proposer;
    address public immutable challenger;

    OutputProposal[] public l2Outputs;

    uint256 public constant SUBMISSION_INTERVAL = 120; // 120 L2 blocks
    uint256 public constant FINALIZATION_PERIOD = 7 days;

    error Unauthorized();
    error InvalidBlockNumber();
    error InvalidTimestamp();
    error OutputNotFound();

    event OutputProposed(
        bytes32 indexed outputRoot,
        uint256 indexed l2OutputIndex,
        uint256 indexed l2BlockNumber,
        uint256 l1Timestamp
    );

    event OutputDeleted(uint256 indexed l2OutputIndex, bytes32 indexed outputRoot);

    constructor(
        uint256 _l2BlockTime,
        uint256 _startingBlockNumber,
        uint256 _startingTimestamp,
        address _proposer,
        address _challenger
    ) {
        l2BlockTime = _l2BlockTime;
        startingBlockNumber = _startingBlockNumber;
        startingTimestamp = _startingTimestamp;
        proposer = _proposer;
        challenger = _challenger;
    }

    function proposeL2Output(
        bytes32 _outputRoot,
        uint256 _l2BlockNumber,
        bytes32 _l1Blockhash,
        uint256 _l1BlockNumber
    ) external payable override {
        if (msg.sender != proposer) revert Unauthorized();

        // Validate the L2 block number
        uint256 nextBlockNumber = nextBlockNumber();
        if (_l2BlockNumber != nextBlockNumber) revert InvalidBlockNumber();

        // Store the output
        l2Outputs.push(
            OutputProposal({
                outputRoot: _outputRoot,
                timestamp: uint128(block.timestamp),
                l2BlockNumber: uint128(_l2BlockNumber)
            })
        );

        emit OutputProposed(
            _outputRoot,
            l2Outputs.length - 1,
            _l2BlockNumber,
            block.timestamp
        );
    }

    function deleteL2Outputs(uint256 _l2OutputIndex) external {
        if (msg.sender != challenger) revert Unauthorized();
        if (_l2OutputIndex >= l2Outputs.length) revert OutputNotFound();

        bytes32 outputRoot = l2Outputs[_l2OutputIndex].outputRoot;
        
        // Delete from the given index onwards
        while (l2Outputs.length > _l2OutputIndex) {
            l2Outputs.pop();
        }

        emit OutputDeleted(_l2OutputIndex, outputRoot);
    }

    function getL2Output(uint256 _l2OutputIndex)
        external
        view
        override
        returns (OutputProposal memory)
    {
        if (_l2OutputIndex >= l2Outputs.length) revert OutputNotFound();
        return l2Outputs[_l2OutputIndex];
    }

    function getL2OutputIndexAfter(uint256 _l2BlockNumber) external view returns (uint256) {
        for (uint256 i = 0; i < l2Outputs.length; i++) {
            if (l2Outputs[i].l2BlockNumber >= _l2BlockNumber) {
                return i;
            }
        }
        revert OutputNotFound();
    }

    function latestOutputIndex() external view override returns (uint256) {
        return l2Outputs.length > 0 ? l2Outputs.length - 1 : 0;
    }

    function latestBlockNumber() external view override returns (uint256) {
        if (l2Outputs.length == 0) return startingBlockNumber;
        return l2Outputs[l2Outputs.length - 1].l2BlockNumber;
    }

    function nextBlockNumber() public view returns (uint256) {
        if (l2Outputs.length == 0) return startingBlockNumber;
        return l2Outputs[l2Outputs.length - 1].l2BlockNumber + SUBMISSION_INTERVAL;
    }

    function finalizationPeriodSeconds() external pure override returns (uint256) {
        return FINALIZATION_PERIOD;
    }

    function sequencerRegistry() external pure override returns (address) {
        return address(0);
    }
}

/**
 * @title OptimismPortalImpl
 * @notice Simplified OptimismPortal for local development
 */
contract OptimismPortalImpl {
    IL2OutputOracle public immutable l2Oracle;

    uint256 public constant FINALIZATION_PERIOD = 7 days;

    mapping(bytes32 => bool) public finalizedWithdrawals;

    struct ProvenWithdrawal {
        bytes32 outputRoot;
        uint128 timestamp;
        uint128 l2OutputIndex;
    }

    mapping(bytes32 => ProvenWithdrawal) public provenWithdrawals;

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

    event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success);

    error AlreadyFinalized();
    error NotProven();
    error ChallengePeriodNotElapsed();

    constructor(address _l2Oracle) {
        l2Oracle = IL2OutputOracle(_l2Oracle);
    }

    /**
     * @notice Accepts deposits of ETH and data into the L2.
     */
    function depositTransaction(
        address _to,
        uint256 _value,
        uint64 _gasLimit,
        bool _isCreation,
        bytes memory _data
    ) external payable {
        // In a real implementation, this encodes the deposit for L2 derivation
        // The op-node watches for TransactionDeposited events
        
        bytes memory opaqueData = abi.encodePacked(
            _value,
            msg.value,
            _gasLimit,
            _isCreation,
            _data
        );

        emit TransactionDeposited(msg.sender, _to, 0, opaqueData);
    }

    /**
     * @notice Proves a withdrawal transaction.
     */
    function proveWithdrawalTransaction(
        address _sender,
        address _target,
        uint256 _value,
        uint256 _gasLimit,
        bytes memory _data,
        uint256 _nonce,
        uint256 _l2OutputIndex,
        bytes32[] memory _withdrawalProof,
        bytes32 _outputRoot
    ) external {
        bytes32 withdrawalHash = keccak256(
            abi.encode(_nonce, _sender, _target, _value, _gasLimit, _data)
        );

        IL2OutputOracle.OutputProposal memory proposal = l2Oracle.getL2Output(_l2OutputIndex);

        // In production, verify the Merkle proof against the output root
        // For local dev, we trust the proof

        provenWithdrawals[withdrawalHash] = ProvenWithdrawal({
            outputRoot: proposal.outputRoot,
            timestamp: uint128(block.timestamp),
            l2OutputIndex: uint128(_l2OutputIndex)
        });

        emit WithdrawalProven(withdrawalHash, _sender, _target);
    }

    /**
     * @notice Finalizes a withdrawal after the challenge period.
     */
    function finalizeWithdrawalTransaction(
        address _sender,
        address _target,
        uint256 _value,
        uint256 _gasLimit,
        bytes memory _data,
        uint256 _nonce
    ) external {
        bytes32 withdrawalHash = keccak256(
            abi.encode(_nonce, _sender, _target, _value, _gasLimit, _data)
        );

        ProvenWithdrawal memory proven = provenWithdrawals[withdrawalHash];
        if (proven.timestamp == 0) revert NotProven();
        if (finalizedWithdrawals[withdrawalHash]) revert AlreadyFinalized();
        if (block.timestamp < proven.timestamp + FINALIZATION_PERIOD) {
            revert ChallengePeriodNotElapsed();
        }

        finalizedWithdrawals[withdrawalHash] = true;

        bool success;
        if (_data.length > 0) {
            (success,) = _target.call{value: _value, gas: _gasLimit}(_data);
        } else {
            (success,) = _target.call{value: _value, gas: _gasLimit}("");
        }

        emit WithdrawalFinalized(withdrawalHash, success);
    }

    receive() external payable {}
}

/**
 * @title SystemConfigImpl
 * @notice Simplified SystemConfig for local development
 */
contract SystemConfigImpl {
    address public owner;
    address public batcher;
    uint64 public gasLimit;
    address public unsafeBlockSigner;
    bytes32 public batchInbox;
    address public optimismPortal;

    event ConfigUpdate(uint256 indexed version, uint8 indexed updateType, bytes data);

    constructor(
        address _owner,
        address _batcher,
        uint64 _gasLimit,
        address _unsafeBlockSigner,
        bytes32 _batchInbox,
        address _portal
    ) {
        owner = _owner;
        batcher = _batcher;
        gasLimit = _gasLimit;
        unsafeBlockSigner = _unsafeBlockSigner;
        batchInbox = _batchInbox;
        optimismPortal = _portal;
    }

    function setGasLimit(uint64 _gasLimit) external {
        require(msg.sender == owner, "Not owner");
        gasLimit = _gasLimit;
        emit ConfigUpdate(0, 0, abi.encode(_gasLimit));
    }

    function setBatcher(address _batcher) external {
        require(msg.sender == owner, "Not owner");
        batcher = _batcher;
        emit ConfigUpdate(0, 1, abi.encode(_batcher));
    }
}

/**
 * @title L1CrossDomainMessengerImpl
 * @notice Simplified L1CrossDomainMessenger for local development
 */
contract L1CrossDomainMessengerImpl {
    address public immutable portal;

    mapping(bytes32 => bool) public successfulMessages;
    mapping(bytes32 => bool) public failedMessages;

    event SentMessage(
        address indexed target,
        address sender,
        bytes message,
        uint256 messageNonce,
        uint256 gasLimit
    );

    event RelayedMessage(bytes32 indexed msgHash);
    event FailedRelayedMessage(bytes32 indexed msgHash);

    uint256 public messageNonce;

    constructor(address _portal) {
        portal = _portal;
    }

    function sendMessage(
        address _target,
        bytes memory _message,
        uint32 _minGasLimit
    ) external payable {
        bytes32 msgHash = keccak256(
            abi.encode(messageNonce, msg.sender, _target, msg.value, _minGasLimit, _message)
        );

        emit SentMessage(_target, msg.sender, _message, messageNonce, _minGasLimit);
        messageNonce++;

        // Call the portal to create the deposit
        OptimismPortalImpl(payable(portal)).depositTransaction{value: msg.value}(
            _target,
            msg.value,
            uint64(_minGasLimit),
            false,
            _message
        );
    }
}

/**
 * @title L1StandardBridgeImpl
 * @notice Simplified L1StandardBridge for local development
 */
contract L1StandardBridgeImpl {
    address payable public immutable messenger;

    mapping(address => mapping(address => uint256)) public deposits;

    event ETHBridgeInitiated(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );

    event ETHBridgeFinalized(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );

    constructor(address payable _messenger) {
        messenger = _messenger;
    }

    function bridgeETH(uint32 _minGasLimit, bytes memory _extraData) external payable {
        _initiateBridgeETH(msg.sender, msg.sender, msg.value, _minGasLimit, _extraData);
    }

    function bridgeETHTo(
        address _to,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external payable {
        _initiateBridgeETH(msg.sender, _to, msg.value, _minGasLimit, _extraData);
    }

    function _initiateBridgeETH(
        address _from,
        address _to,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) internal {
        deposits[address(0)][_from] += _amount;

        emit ETHBridgeInitiated(_from, _to, _amount, _extraData);

        // Send via messenger
        L1CrossDomainMessengerImpl(messenger).sendMessage{value: _amount}(
            _to,
            abi.encodeWithSignature("finalizeBridgeETH(address,address,uint256,bytes)", _from, _to, _amount, _extraData),
            _minGasLimit
        );
    }

    receive() external payable {}
}


