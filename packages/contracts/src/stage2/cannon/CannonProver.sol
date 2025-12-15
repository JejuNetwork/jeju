// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IProver.sol";
import "../interfaces/IMips.sol";

/// @title CannonProver
/// @notice Adapter that integrates with Optimism's Cannon MIPS VM for real fraud proofs
/// @dev This contract wraps the Cannon VM to provide fraud proof verification
///      compatible with our DisputeGameFactory.
///
/// CANNON INTEGRATION GUIDE:
/// 1. Deploy MIPS.sol from optimism contracts-bedrock
/// 2. Deploy PreimageOracle.sol  
/// 3. Deploy this CannonProver with MIPS and Oracle addresses
/// 4. Register CannonProver with DisputeGameFactory
/// 5. Configure op-challenger with matching Cannon binary
///
/// The MIPS VM executes single instructions at a time, enabling
/// interactive bisection games to find the exact instruction
/// where a fault occurred.
contract CannonProver is IProver {
    /// @notice The Cannon MIPS VM contract
    IMIPS public immutable mips;
    
    /// @notice The preimage oracle for loading state data
    IPreimageOracle public immutable oracle;
    
    /// @notice Maximum number of steps for bisection game
    uint256 public constant MAX_GAME_DEPTH = 73;
    
    /// @notice Step execution gas limit
    uint256 public constant STEP_GAS_LIMIT = 400_000;

    /// @notice Claim data for bisection game
    struct ClaimNode {
        bytes32 stateHash;
        uint256 position;
        bool countered;
    }

    /// @notice Active disputes
    mapping(bytes32 => ClaimNode[]) public disputes;
    
    event StepVerified(bytes32 indexed disputeId, uint256 position, bytes32 preState, bytes32 postState);
    event DisputeResolved(bytes32 indexed disputeId, bool challengerWins);

    error InvalidMIPSContract();
    error InvalidOracleContract();
    error InvalidProofData();
    error StepExecutionFailed();
    error InvalidStateTransition();

    constructor(address _mips, address _oracle) {
        if (_mips == address(0)) revert InvalidMIPSContract();
        if (_oracle == address(0)) revert InvalidOracleContract();
        mips = IMIPS(_mips);
        oracle = IPreimageOracle(_oracle);
    }

    /// @notice Verify a fraud proof by executing a single MIPS step
    /// @param _preStateRoot The claimed pre-state root
    /// @param _postStateRoot The claimed post-state root  
    /// @param _proof Encoded proof containing:
    ///        - stateData: The pre-state data
    ///        - memoryProof: Merkle proof for memory access
    ///        - localContext: Context for preimage oracle
    /// @return valid True if the proof shows invalid state transition
    function verifyProof(
        bytes32 _preStateRoot,
        bytes32 _postStateRoot,
        bytes calldata _proof
    ) external view override returns (bool valid) {
        if (_proof.length < 100) revert InvalidProofData();
        
        // Decode proof components
        (
            bytes memory stateData,
            bytes memory memoryProof,
            bytes32 localContext
        ) = abi.decode(_proof, (bytes, bytes, bytes32));

        // Verify pre-state matches claimed root
        bytes32 computedPreState = keccak256(stateData);
        if (computedPreState != _preStateRoot) {
            return false;
        }

        // Execute single MIPS step via static call to avoid state changes
        // In production, this would call mips.step() but we use staticcall pattern
        bytes memory callData = abi.encodeCall(IMIPS.step, (stateData, memoryProof, localContext));
        
        (bool success, bytes memory result) = address(mips).staticcall{gas: STEP_GAS_LIMIT}(callData);
        
        if (!success) {
            // Step execution failed - could be invalid instruction or memory fault
            // This is a valid challenge if proposer claimed success
            return true;
        }

        bytes32 computedPostState = abi.decode(result, (bytes32));
        
        // If computed post-state doesn't match claimed post-state, fraud is proven
        return computedPostState != _postStateRoot;
    }

    /// @notice Verify a defense proof (proposer proving their claim is correct)
    /// @param _preStateRoot Pre-state root
    /// @param _postStateRoot Post-state root
    /// @param _proof Defense proof data
    /// @return valid True if defense is valid
    function verifyDefenseProof(
        bytes32 _preStateRoot,
        bytes32 _postStateRoot,
        bytes calldata _proof
    ) external view override returns (bool valid) {
        if (_proof.length < 100) revert InvalidProofData();
        
        (
            bytes memory stateData,
            bytes memory memoryProof,
            bytes32 localContext
        ) = abi.decode(_proof, (bytes, bytes, bytes32));

        // Verify pre-state
        bytes32 computedPreState = keccak256(stateData);
        if (computedPreState != _preStateRoot) {
            return false;
        }

        // Execute step
        bytes memory callData = abi.encodeCall(IMIPS.step, (stateData, memoryProof, localContext));
        (bool success, bytes memory result) = address(mips).staticcall{gas: STEP_GAS_LIMIT}(callData);
        
        if (!success) {
            return false;
        }

        bytes32 computedPostState = abi.decode(result, (bytes32));
        
        // Defense is valid if computed matches claimed
        return computedPostState == _postStateRoot;
    }

    /// @notice Start an interactive bisection game
    /// @param _disputeId Unique dispute identifier
    /// @param _rootClaim The state root being disputed
    function startBisection(bytes32 _disputeId, bytes32 _rootClaim) external {
        disputes[_disputeId].push(ClaimNode({
            stateHash: _rootClaim,
            position: 1,
            countered: false
        }));
    }

    /// @notice Make a move in the bisection game
    /// @param _disputeId The dispute ID
    /// @param _parentIndex Index of parent claim
    /// @param _claim The new intermediate state claim
    /// @param _isAttack True if attacking, false if defending
    function bisect(
        bytes32 _disputeId,
        uint256 _parentIndex,
        bytes32 _claim,
        bool _isAttack
    ) external {
        ClaimNode[] storage claims = disputes[_disputeId];
        ClaimNode storage parent = claims[_parentIndex];
        
        uint256 newPosition = _isAttack 
            ? parent.position * 2      // Attack: go to left child
            : parent.position * 2 + 1; // Defend: go to right child
            
        claims.push(ClaimNode({
            stateHash: _claim,
            position: newPosition,
            countered: false
        }));
        
        parent.countered = true;
    }

    /// @notice Execute final step to resolve dispute at leaf level
    /// @param _disputeId The dispute ID
    /// @param _claimIndex The claim index to resolve
    /// @param _stateData Pre-state data
    /// @param _proof Memory proof
    function step(
        bytes32 _disputeId,
        uint256 _claimIndex,
        bytes calldata _stateData,
        bytes calldata _proof
    ) external {
        ClaimNode[] storage claims = disputes[_disputeId];
        ClaimNode storage claim = claims[_claimIndex];
        
        // Execute MIPS step
        bytes32 postState;
        try mips.step(_stateData, _proof, bytes32(0)) returns (bytes32 result) {
            postState = result;
        } catch {
            // Execution failed - challenger wins if they claimed it would fail
            emit DisputeResolved(_disputeId, true);
            return;
        }
        
        bytes32 preState = keccak256(_stateData);
        emit StepVerified(_disputeId, claim.position, preState, postState);
        
        // Determine winner based on state comparison
        bool challengerWins = postState != claim.stateHash;
        emit DisputeResolved(_disputeId, challengerWins);
    }

    /// @notice Get the Cannon VM address
    function getMIPS() external view returns (address) {
        return address(mips);
    }

    /// @notice Get the oracle address
    function getOracle() external view returns (address) {
        return address(oracle);
    }

    /// @notice Get the prover type
    function proverType() external pure override returns (string memory) {
        return "cannon-mips64";
    }
}

