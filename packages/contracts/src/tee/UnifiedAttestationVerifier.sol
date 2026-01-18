// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title UnifiedAttestationVerifier
 * @author Jeju Network
 * @notice Hybrid TEE attestation verification with on-chain whitelist, off-chain verification, and slashing
 * @dev Implements optimistic verification pattern:
 *      1. Provider submits attestation with stake
 *      2. Attestation is optimistically accepted
 *      3. Verifiers can challenge invalid attestations
 *      4. Invalid attestations result in stake slashing
 *
 * Supported TEE Platforms:
 * - Intel TDX (Trust Domain Extensions)
 * - Intel SGX (Software Guard Extensions) 
 * - AMD SEV-SNP (Secure Encrypted Virtualization)
 * - Phala Network TEE
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract UnifiedAttestationVerifier is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Roles ============
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    // ============ Enums ============
    enum TEEPlatform {
        NONE,
        INTEL_TDX,
        INTEL_SGX,
        AMD_SEV_SNP,
        PHALA,
        AWS_NITRO,
        GCP_CONFIDENTIAL
    }

    enum AttestationStatus {
        PENDING,        // Submitted, waiting for challenge period
        VERIFIED,       // Challenge period passed or explicitly verified
        CHALLENGED,     // Under challenge
        INVALID,        // Challenge succeeded, attestation invalid
        EXPIRED         // Past validity period
    }

    // ============ Structs ============
    struct TrustedMeasurement {
        bytes32 mrEnclave;      // Enclave code measurement
        bytes32 mrSigner;       // Enclave signer measurement
        TEEPlatform platform;   // TEE platform type
        string description;     // Human-readable description
        uint256 addedAt;        // When measurement was added
        bool active;            // Whether measurement is currently trusted
    }

    struct Attestation {
        bytes32 nodeId;             // Unique node identifier
        address provider;           // Provider address
        TEEPlatform platform;       // TEE platform
        bytes32 mrEnclave;          // Enclave measurement
        bytes32 mrSigner;           // Signer measurement
        bytes quote;                // Raw attestation quote
        bytes32 reportData;         // Custom report data
        uint256 submittedAt;        // Submission timestamp
        uint256 expiresAt;          // Expiration timestamp
        AttestationStatus status;   // Current status
        uint256 stake;              // Stake amount
        address challenger;         // Address that challenged (if any)
        uint256 challengeDeadline;  // Challenge resolution deadline
    }

    struct Challenge {
        bytes32 attestationId;      // Attestation being challenged
        address challenger;         // Who submitted challenge
        uint256 stake;              // Challenge stake
        uint256 submittedAt;        // Challenge submission time
        uint256 deadline;           // Resolution deadline
        bool resolved;              // Whether resolved
        bool successful;            // Whether challenge succeeded
        string reason;              // Challenge reason
    }

    // ============ State Variables ============
    
    /// @notice Trusted measurements whitelist
    mapping(bytes32 => TrustedMeasurement) public trustedMeasurements;
    bytes32[] public measurementList;

    /// @notice Attestations by ID
    mapping(bytes32 => Attestation) public attestations;
    bytes32[] public attestationList;

    /// @notice Node ID to latest attestation ID
    mapping(bytes32 => bytes32) public nodeLatestAttestation;

    /// @notice Provider to attestation IDs
    mapping(address => bytes32[]) public providerAttestations;

    /// @notice Challenges by ID
    mapping(bytes32 => Challenge) public challenges;
    bytes32[] public challengeList;

    /// @notice Attestation ID to challenge IDs
    mapping(bytes32 => bytes32[]) public attestationChallenges;

    // ============ Configuration ============
    
    /// @notice Minimum stake for attestation submission
    uint256 public minAttestationStake;
    
    /// @notice Minimum stake for challenges
    uint256 public minChallengeStake;
    
    /// @notice Challenge period duration (seconds)
    uint256 public challengePeriod;
    
    /// @notice Challenge resolution deadline (seconds)
    uint256 public challengeResolutionPeriod;
    
    /// @notice Default attestation validity (seconds)
    uint256 public defaultAttestationValidity;

    /// @notice Slash percentage (basis points, 10000 = 100%)
    uint256 public slashPercentage;

    /// @notice Treasury for slashed funds
    address public treasury;

    /// @notice Total slashed amount
    uint256 public totalSlashed;

    // ============ Events ============
    
    event MeasurementAdded(
        bytes32 indexed measurementHash,
        bytes32 mrEnclave,
        bytes32 mrSigner,
        TEEPlatform platform,
        string description
    );

    event MeasurementRemoved(bytes32 indexed measurementHash);

    event AttestationSubmitted(
        bytes32 indexed attestationId,
        bytes32 indexed nodeId,
        address indexed provider,
        TEEPlatform platform,
        bytes32 mrEnclave,
        uint256 stake
    );

    event AttestationVerified(
        bytes32 indexed attestationId,
        address indexed verifier
    );

    event AttestationExpired(bytes32 indexed attestationId);

    event AttestationChallenged(
        bytes32 indexed attestationId,
        bytes32 indexed challengeId,
        address indexed challenger,
        uint256 stake,
        string reason
    );

    event ChallengeResolved(
        bytes32 indexed challengeId,
        bytes32 indexed attestationId,
        bool successful,
        uint256 slashedAmount
    );

    event StakeSlashed(
        bytes32 indexed attestationId,
        address indexed provider,
        uint256 amount,
        address indexed recipient
    );

    event ConfigUpdated(string parameter, uint256 oldValue, uint256 newValue);

    // ============ Errors ============
    
    error InvalidPlatform();
    error UntrustedMeasurement(bytes32 mrEnclave);
    error InsufficientStake(uint256 provided, uint256 required);
    error AttestationNotFound(bytes32 attestationId);
    error AttestationAlreadyExists(bytes32 attestationId);
    error InvalidAttestationStatus(AttestationStatus current, AttestationStatus expected);
    error ChallengePeriodActive();
    error ChallengePeriodExpired();
    error ChallengeNotFound(bytes32 challengeId);
    error ChallengeAlreadyResolved();
    error ChallengeDeadlineNotReached();
    error InvalidQuoteFormat();
    error QuoteExpired();
    error SelfChallenge();
    error TransferFailed();
    error ZeroAddress();
    error MeasurementAlreadyTrusted(bytes32 measurementHash);
    error MeasurementNotFound(bytes32 measurementHash);

    // ============ Constructor ============
    
    constructor(
        address admin,
        address _treasury,
        uint256 _minAttestationStake,
        uint256 _minChallengeStake,
        uint256 _challengePeriod,
        uint256 _defaultValidity
    ) {
        if (admin == address(0) || _treasury == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        _grantRole(SLASHER_ROLE, admin);

        treasury = _treasury;
        minAttestationStake = _minAttestationStake;
        minChallengeStake = _minChallengeStake;
        challengePeriod = _challengePeriod;
        challengeResolutionPeriod = 7 days;
        defaultAttestationValidity = _defaultValidity;
        slashPercentage = 5000; // 50%
    }

    // ============ Measurement Management ============

    /**
     * @notice Add a trusted measurement to the whitelist
     * @param mrEnclave Enclave code measurement
     * @param mrSigner Enclave signer measurement
     * @param platform TEE platform type
     * @param description Human-readable description
     */
    function addTrustedMeasurement(
        bytes32 mrEnclave,
        bytes32 mrSigner,
        TEEPlatform platform,
        string calldata description
    ) external onlyRole(ADMIN_ROLE) {
        if (platform == TEEPlatform.NONE) revert InvalidPlatform();

        bytes32 measurementHash = keccak256(abi.encodePacked(mrEnclave, mrSigner, platform));
        
        if (trustedMeasurements[measurementHash].addedAt != 0) {
            revert MeasurementAlreadyTrusted(measurementHash);
        }

        trustedMeasurements[measurementHash] = TrustedMeasurement({
            mrEnclave: mrEnclave,
            mrSigner: mrSigner,
            platform: platform,
            description: description,
            addedAt: block.timestamp,
            active: true
        });

        measurementList.push(measurementHash);

        emit MeasurementAdded(measurementHash, mrEnclave, mrSigner, platform, description);
    }

    /**
     * @notice Remove a trusted measurement from the whitelist
     * @param measurementHash Hash of the measurement to remove
     */
    function removeTrustedMeasurement(bytes32 measurementHash) external onlyRole(ADMIN_ROLE) {
        TrustedMeasurement storage measurement = trustedMeasurements[measurementHash];
        if (measurement.addedAt == 0) revert MeasurementNotFound(measurementHash);

        measurement.active = false;

        emit MeasurementRemoved(measurementHash);
    }

    /**
     * @notice Check if a measurement is trusted
     * @param mrEnclave Enclave measurement
     * @param mrSigner Signer measurement
     * @param platform TEE platform
     * @return trusted Whether measurement is trusted
     */
    function isTrustedMeasurement(
        bytes32 mrEnclave,
        bytes32 mrSigner,
        TEEPlatform platform
    ) public view returns (bool trusted) {
        bytes32 measurementHash = keccak256(abi.encodePacked(mrEnclave, mrSigner, platform));
        TrustedMeasurement storage measurement = trustedMeasurements[measurementHash];
        return measurement.addedAt != 0 && measurement.active;
    }

    // ============ Attestation Submission ============

    /**
     * @notice Submit a new attestation
     * @param nodeId Unique node identifier
     * @param platform TEE platform type
     * @param mrEnclave Enclave measurement
     * @param mrSigner Signer measurement
     * @param quote Raw attestation quote
     * @param reportData Custom report data
     * @param validityPeriod Custom validity period (0 for default)
     */
    function submitAttestation(
        bytes32 nodeId,
        TEEPlatform platform,
        bytes32 mrEnclave,
        bytes32 mrSigner,
        bytes calldata quote,
        bytes32 reportData,
        uint256 validityPeriod
    ) external payable nonReentrant whenNotPaused {
        if (platform == TEEPlatform.NONE) revert InvalidPlatform();
        if (msg.value < minAttestationStake) {
            revert InsufficientStake(msg.value, minAttestationStake);
        }
        if (!isTrustedMeasurement(mrEnclave, mrSigner, platform)) {
            revert UntrustedMeasurement(mrEnclave);
        }

        // Validate quote structure (basic checks - detailed verification off-chain)
        if (quote.length < 128) revert InvalidQuoteFormat();

        // Generate attestation ID
        bytes32 attestationId = keccak256(
            abi.encodePacked(nodeId, msg.sender, mrEnclave, block.timestamp)
        );

        if (attestations[attestationId].submittedAt != 0) {
            revert AttestationAlreadyExists(attestationId);
        }

        uint256 validity = validityPeriod > 0 ? validityPeriod : defaultAttestationValidity;

        attestations[attestationId] = Attestation({
            nodeId: nodeId,
            provider: msg.sender,
            platform: platform,
            mrEnclave: mrEnclave,
            mrSigner: mrSigner,
            quote: quote,
            reportData: reportData,
            submittedAt: block.timestamp,
            expiresAt: block.timestamp + validity,
            status: AttestationStatus.PENDING,
            stake: msg.value,
            challenger: address(0),
            challengeDeadline: 0
        });

        attestationList.push(attestationId);
        nodeLatestAttestation[nodeId] = attestationId;
        providerAttestations[msg.sender].push(attestationId);

        emit AttestationSubmitted(
            attestationId,
            nodeId,
            msg.sender,
            platform,
            mrEnclave,
            msg.value
        );
    }

    /**
     * @notice Finalize attestation after challenge period (anyone can call)
     * @param attestationId Attestation to finalize
     */
    function finalizeAttestation(bytes32 attestationId) external nonReentrant {
        Attestation storage attestation = attestations[attestationId];
        if (attestation.submittedAt == 0) revert AttestationNotFound(attestationId);
        
        if (attestation.status != AttestationStatus.PENDING) {
            revert InvalidAttestationStatus(attestation.status, AttestationStatus.PENDING);
        }

        // Check challenge period has passed
        if (block.timestamp < attestation.submittedAt + challengePeriod) {
            revert ChallengePeriodActive();
        }

        // Check for active challenges
        bytes32[] storage attestChallenges = attestationChallenges[attestationId];
        for (uint256 i = 0; i < attestChallenges.length; i++) {
            Challenge storage challenge = challenges[attestChallenges[i]];
            if (!challenge.resolved) {
                revert ChallengePeriodActive();
            }
        }

        attestation.status = AttestationStatus.VERIFIED;

        // Return stake to provider
        uint256 stake = attestation.stake;
        attestation.stake = 0;
        
        (bool success,) = attestation.provider.call{value: stake}("");
        if (!success) revert TransferFailed();

        emit AttestationVerified(attestationId, msg.sender);
    }

    /**
     * @notice Explicitly verify attestation (verifier only, bypasses challenge period)
     * @param attestationId Attestation to verify
     */
    function verifyAttestation(bytes32 attestationId) external onlyRole(VERIFIER_ROLE) nonReentrant {
        Attestation storage attestation = attestations[attestationId];
        if (attestation.submittedAt == 0) revert AttestationNotFound(attestationId);
        
        if (attestation.status != AttestationStatus.PENDING) {
            revert InvalidAttestationStatus(attestation.status, AttestationStatus.PENDING);
        }

        attestation.status = AttestationStatus.VERIFIED;

        // Return stake to provider
        uint256 stake = attestation.stake;
        attestation.stake = 0;
        
        (bool success,) = attestation.provider.call{value: stake}("");
        if (!success) revert TransferFailed();

        emit AttestationVerified(attestationId, msg.sender);
    }

    // ============ Challenge System ============

    /**
     * @notice Challenge an attestation
     * @param attestationId Attestation to challenge
     * @param reason Reason for challenge
     */
    function challengeAttestation(
        bytes32 attestationId,
        string calldata reason
    ) external payable nonReentrant whenNotPaused {
        Attestation storage attestation = attestations[attestationId];
        if (attestation.submittedAt == 0) revert AttestationNotFound(attestationId);
        
        if (attestation.status != AttestationStatus.PENDING) {
            revert InvalidAttestationStatus(attestation.status, AttestationStatus.PENDING);
        }

        if (msg.sender == attestation.provider) revert SelfChallenge();
        
        if (msg.value < minChallengeStake) {
            revert InsufficientStake(msg.value, minChallengeStake);
        }

        // Challenge period must still be active
        if (block.timestamp > attestation.submittedAt + challengePeriod) {
            revert ChallengePeriodExpired();
        }

        bytes32 challengeId = keccak256(
            abi.encodePacked(attestationId, msg.sender, block.timestamp)
        );

        challenges[challengeId] = Challenge({
            attestationId: attestationId,
            challenger: msg.sender,
            stake: msg.value,
            submittedAt: block.timestamp,
            deadline: block.timestamp + challengeResolutionPeriod,
            resolved: false,
            successful: false,
            reason: reason
        });

        challengeList.push(challengeId);
        attestationChallenges[attestationId].push(challengeId);

        attestation.status = AttestationStatus.CHALLENGED;
        attestation.challenger = msg.sender;
        attestation.challengeDeadline = block.timestamp + challengeResolutionPeriod;

        emit AttestationChallenged(attestationId, challengeId, msg.sender, msg.value, reason);
    }

    /**
     * @notice Resolve a challenge (verifier only)
     * @param challengeId Challenge to resolve
     * @param challengeSuccessful Whether the challenge succeeded
     */
    function resolveChallenge(
        bytes32 challengeId,
        bool challengeSuccessful
    ) external onlyRole(VERIFIER_ROLE) nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        if (challenge.submittedAt == 0) revert ChallengeNotFound(challengeId);
        if (challenge.resolved) revert ChallengeAlreadyResolved();

        Attestation storage attestation = attestations[challenge.attestationId];

        challenge.resolved = true;
        challenge.successful = challengeSuccessful;

        uint256 slashedAmount = 0;

        if (challengeSuccessful) {
            // Challenge succeeded - slash provider, reward challenger
            attestation.status = AttestationStatus.INVALID;
            
            uint256 providerStake = attestation.stake;
            slashedAmount = (providerStake * slashPercentage) / 10000;
            uint256 challengerReward = slashedAmount + challenge.stake;
            
            attestation.stake = 0;
            totalSlashed += slashedAmount;

            // Send remaining provider stake to treasury
            uint256 treasuryAmount = providerStake - slashedAmount;
            if (treasuryAmount > 0) {
                (bool success1,) = treasury.call{value: treasuryAmount}("");
                if (!success1) revert TransferFailed();
            }

            // Reward challenger
            (bool success2,) = challenge.challenger.call{value: challengerReward}("");
            if (!success2) revert TransferFailed();

            emit StakeSlashed(challenge.attestationId, attestation.provider, slashedAmount, challenge.challenger);
        } else {
            // Challenge failed - return stakes, mark attestation verified
            attestation.status = AttestationStatus.VERIFIED;
            
            // Return provider stake
            uint256 providerStake = attestation.stake;
            attestation.stake = 0;
            (bool success1,) = attestation.provider.call{value: providerStake}("");
            if (!success1) revert TransferFailed();

            // Slash challenger stake partially, send to treasury
            uint256 challengerSlash = (challenge.stake * slashPercentage) / 10000;
            uint256 challengerReturn = challenge.stake - challengerSlash;
            
            if (challengerSlash > 0) {
                (bool success2,) = treasury.call{value: challengerSlash}("");
                if (!success2) revert TransferFailed();
            }
            
            if (challengerReturn > 0) {
                (bool success3,) = challenge.challenger.call{value: challengerReturn}("");
                if (!success3) revert TransferFailed();
            }
        }

        emit ChallengeResolved(challengeId, challenge.attestationId, challengeSuccessful, slashedAmount);
    }

    /**
     * @notice Auto-resolve challenge after deadline (anyone can call)
     * @param challengeId Challenge to resolve
     */
    function autoResolveChallenge(bytes32 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        if (challenge.submittedAt == 0) revert ChallengeNotFound(challengeId);
        if (challenge.resolved) revert ChallengeAlreadyResolved();
        if (block.timestamp < challenge.deadline) revert ChallengeDeadlineNotReached();

        // If deadline passed without verifier resolution, assume attestation valid
        // (Optimistic verification)
        challenge.resolved = true;
        challenge.successful = false;

        Attestation storage attestation = attestations[challenge.attestationId];
        attestation.status = AttestationStatus.VERIFIED;

        // Return provider stake
        uint256 providerStake = attestation.stake;
        attestation.stake = 0;
        (bool success1,) = attestation.provider.call{value: providerStake}("");
        if (!success1) revert TransferFailed();

        // Return challenger stake (no penalty for timeout)
        (bool success2,) = challenge.challenger.call{value: challenge.stake}("");
        if (!success2) revert TransferFailed();

        emit ChallengeResolved(challengeId, challenge.attestationId, false, 0);
    }

    // ============ View Functions ============

    /**
     * @notice Check if attestation is currently valid
     * @param attestationId Attestation ID
     * @return valid Whether attestation is valid
     * @return expiresAt When attestation expires
     */
    function isAttestationValid(bytes32 attestationId) 
        external 
        view 
        returns (bool valid, uint256 expiresAt) 
    {
        Attestation storage attestation = attestations[attestationId];
        if (attestation.submittedAt == 0) return (false, 0);
        
        valid = attestation.status == AttestationStatus.VERIFIED &&
                block.timestamp < attestation.expiresAt;
        expiresAt = attestation.expiresAt;
    }

    /**
     * @notice Check if node has valid attestation
     * @param nodeId Node ID
     * @return valid Whether node has valid attestation
     * @return attestationId Latest attestation ID
     */
    function isNodeAttested(bytes32 nodeId) 
        external 
        view 
        returns (bool valid, bytes32 attestationId) 
    {
        attestationId = nodeLatestAttestation[nodeId];
        if (attestationId == bytes32(0)) return (false, bytes32(0));
        
        Attestation storage attestation = attestations[attestationId];
        valid = attestation.status == AttestationStatus.VERIFIED &&
                block.timestamp < attestation.expiresAt;
    }

    /**
     * @notice Get attestation details
     * @param attestationId Attestation ID
     * @return attestation Full attestation struct
     */
    function getAttestation(bytes32 attestationId) 
        external 
        view 
        returns (Attestation memory attestation) 
    {
        return attestations[attestationId];
    }

    /**
     * @notice Get challenge details
     * @param challengeId Challenge ID
     * @return challenge Full challenge struct
     */
    function getChallenge(bytes32 challengeId) 
        external 
        view 
        returns (Challenge memory challenge) 
    {
        return challenges[challengeId];
    }

    /**
     * @notice Get all attestations for a provider
     * @param provider Provider address
     * @return attestationIds Array of attestation IDs
     */
    function getProviderAttestations(address provider) 
        external 
        view 
        returns (bytes32[] memory attestationIds) 
    {
        return providerAttestations[provider];
    }

    /**
     * @notice Get all trusted measurements
     * @return hashes Array of measurement hashes
     */
    function getTrustedMeasurements() external view returns (bytes32[] memory hashes) {
        return measurementList;
    }

    /**
     * @notice Get trusted measurement details
     * @param measurementHash Measurement hash
     * @return measurement Full measurement struct
     */
    function getTrustedMeasurement(bytes32 measurementHash) 
        external 
        view 
        returns (TrustedMeasurement memory measurement) 
    {
        return trustedMeasurements[measurementHash];
    }

    // ============ Admin Functions ============

    /**
     * @notice Update minimum attestation stake
     * @param newStake New minimum stake
     */
    function setMinAttestationStake(uint256 newStake) external onlyRole(ADMIN_ROLE) {
        emit ConfigUpdated("minAttestationStake", minAttestationStake, newStake);
        minAttestationStake = newStake;
    }

    /**
     * @notice Update minimum challenge stake
     * @param newStake New minimum stake
     */
    function setMinChallengeStake(uint256 newStake) external onlyRole(ADMIN_ROLE) {
        emit ConfigUpdated("minChallengeStake", minChallengeStake, newStake);
        minChallengeStake = newStake;
    }

    /**
     * @notice Update challenge period
     * @param newPeriod New challenge period in seconds
     */
    function setChallengePeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        emit ConfigUpdated("challengePeriod", challengePeriod, newPeriod);
        challengePeriod = newPeriod;
    }

    /**
     * @notice Update challenge resolution period
     * @param newPeriod New resolution period in seconds
     */
    function setChallengeResolutionPeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        emit ConfigUpdated("challengeResolutionPeriod", challengeResolutionPeriod, newPeriod);
        challengeResolutionPeriod = newPeriod;
    }

    /**
     * @notice Update default attestation validity
     * @param newValidity New validity period in seconds
     */
    function setDefaultAttestationValidity(uint256 newValidity) external onlyRole(ADMIN_ROLE) {
        emit ConfigUpdated("defaultAttestationValidity", defaultAttestationValidity, newValidity);
        defaultAttestationValidity = newValidity;
    }

    /**
     * @notice Update slash percentage
     * @param newPercentage New percentage in basis points
     */
    function setSlashPercentage(uint256 newPercentage) external onlyRole(ADMIN_ROLE) {
        require(newPercentage <= 10000, "Invalid percentage");
        emit ConfigUpdated("slashPercentage", slashPercentage, newPercentage);
        slashPercentage = newPercentage;
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
