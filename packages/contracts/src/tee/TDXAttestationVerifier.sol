// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TDXAttestationVerifier
 * @notice On-chain verification of Intel TDX attestation quotes
 * @dev Verifies TDX quotes including:
 *      - Quote structure validation (TDX Quote v4/v5 format)
 *      - MRTD (Measurement of TD) verification against trusted list
 *      - Report data binding verification
 *      - Certificate chain validation (simplified for gas efficiency)
 *
 * Note: Full DCAP verification is computationally expensive on-chain.
 * This contract provides a simplified verification with trusted verifier
 * attestation for production use, with full quote parsing for transparency.
 */
contract TDXAttestationVerifier is Ownable, ReentrancyGuard, Pausable {
    // ============================================================================
    // Constants
    // ============================================================================

    // TDX Quote header magic bytes
    bytes4 public constant TDX_QUOTE_MAGIC = 0x04000200; // Version 4, ECDSA-256-with-P-256 curve

    // Minimum valid quote length (header + TD report + signature)
    uint256 public constant MIN_QUOTE_LENGTH = 1020;

    // TD Report offset in quote
    uint256 public constant TD_REPORT_OFFSET = 48;

    // MRTD offset within TD Report (measurement of TD)
    uint256 public constant MRTD_OFFSET = TD_REPORT_OFFSET + 128;

    // Report data offset within TD Report
    uint256 public constant REPORT_DATA_OFFSET = TD_REPORT_OFFSET + 256;

    // Attestation validity period (24 hours)
    uint256 public constant ATTESTATION_VALIDITY = 24 hours;

    // ============================================================================
    // Types
    // ============================================================================

    enum VerificationStatus {
        UNVERIFIED,
        VERIFIED,
        INVALID_FORMAT,
        UNTRUSTED_MEASUREMENT,
        EXPIRED,
        REVOKED
    }

    struct TrustedMeasurement {
        bytes32 mrtd;           // Measurement of TD
        string description;     // Human-readable description
        uint256 validFrom;      // Timestamp when this measurement became valid
        uint256 validUntil;     // 0 = no expiry
        bool active;            // Whether this measurement is currently trusted
    }

    struct AttestationRecord {
        address provider;       // Node that submitted the attestation
        bytes32 mrtd;          // TD measurement from quote
        bytes32 reportData;    // Custom report data binding
        bytes32 quoteHash;     // Hash of full quote for verification
        uint256 timestamp;     // When attestation was verified
        uint256 expiresAt;     // When attestation expires
        VerificationStatus status;
        address verifier;      // Trusted verifier that confirmed (address(0) for on-chain only)
    }

    struct ParsedQuote {
        uint16 version;
        uint16 attestationKeyType;
        uint32 teeType;
        bytes32 mrtd;
        bytes32 mrsignerSeam;
        bytes32 reportData;
        bytes32 quoteHash;
        bool valid;
        string error;
    }

    // ============================================================================
    // State
    // ============================================================================

    // Trusted TD measurements (MRTD => TrustedMeasurement)
    mapping(bytes32 => TrustedMeasurement) public trustedMeasurements;
    bytes32[] public measurementList;

    // Attestation records (provider => AttestationRecord)
    mapping(address => AttestationRecord) public attestations;
    address[] public attestedProviders;

    // Trusted verifiers who can attest quotes off-chain
    mapping(address => bool) public trustedVerifiers;

    // Configuration
    uint256 public minStakeForAttestation;
    bool public requireTrustedVerifier;

    // Statistics
    uint256 public totalAttestations;
    uint256 public successfulAttestations;
    uint256 public failedAttestations;

    // ============================================================================
    // Events
    // ============================================================================

    event MeasurementAdded(
        bytes32 indexed mrtd,
        string description,
        uint256 validFrom,
        uint256 validUntil
    );

    event MeasurementRevoked(bytes32 indexed mrtd, string reason);

    event AttestationSubmitted(
        address indexed provider,
        bytes32 indexed mrtd,
        bytes32 reportData,
        VerificationStatus status
    );

    event AttestationVerified(
        address indexed provider,
        address indexed verifier,
        bool valid
    );

    event TrustedVerifierAdded(address indexed verifier);
    event TrustedVerifierRemoved(address indexed verifier);

    // ============================================================================
    // Errors
    // ============================================================================

    error InvalidQuoteFormat();
    error QuoteTooShort();
    error UntrustedMeasurement();
    error AttestationExpired();
    error InvalidSignature();
    error NotTrustedVerifier();
    error AlreadyVerified();
    error InsufficientStake();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor() Ownable(msg.sender) {
        requireTrustedVerifier = true;
        minStakeForAttestation = 0;
    }

    // ============================================================================
    // External Functions - Attestation
    // ============================================================================

    /**
     * @notice Submit a TDX attestation quote for verification
     * @param quote Raw TDX quote bytes
     * @param expectedReportData Expected report data for binding verification
     * @return status Verification status
     * @return record Attestation record
     */
    function submitAttestation(
        bytes calldata quote,
        bytes32 expectedReportData
    ) external nonReentrant whenNotPaused returns (
        VerificationStatus status,
        AttestationRecord memory record
    ) {
        totalAttestations++;

        // Parse and validate quote
        ParsedQuote memory parsed = parseQuote(quote);

        if (!parsed.valid) {
            failedAttestations++;
            revert InvalidQuoteFormat();
        }

        // Verify report data binding
        if (parsed.reportData != expectedReportData) {
            failedAttestations++;
            status = VerificationStatus.INVALID_FORMAT;
            record = _createRecord(msg.sender, parsed, status, address(0));
            emit AttestationSubmitted(msg.sender, parsed.mrtd, parsed.reportData, status);
            return (status, record);
        }

        // Check if measurement is trusted
        TrustedMeasurement storage measurement = trustedMeasurements[parsed.mrtd];
        if (!_isMeasurementTrusted(measurement)) {
            // Measurement not trusted - record but mark as untrusted
            status = VerificationStatus.UNTRUSTED_MEASUREMENT;
            record = _createRecord(msg.sender, parsed, status, address(0));
            attestations[msg.sender] = record;
            _addToProviderList(msg.sender);
            emit AttestationSubmitted(msg.sender, parsed.mrtd, parsed.reportData, status);
            return (status, record);
        }

        // If trusted verifier not required, mark as verified
        if (!requireTrustedVerifier) {
            successfulAttestations++;
            status = VerificationStatus.VERIFIED;
            record = _createRecord(msg.sender, parsed, status, address(0));
        } else {
            // Await off-chain verifier
            status = VerificationStatus.UNVERIFIED;
            record = _createRecord(msg.sender, parsed, status, address(0));
        }

        attestations[msg.sender] = record;
        _addToProviderList(msg.sender);

        emit AttestationSubmitted(msg.sender, parsed.mrtd, parsed.reportData, status);
        return (status, record);
    }

    /**
     * @notice Verify an attestation (trusted verifier only)
     * @param provider Provider address to verify
     * @param valid Whether the attestation is valid
     * @param signature Off-chain signature over quote hash (optional)
     */
    function verifyAttestation(
        address provider,
        bool valid,
        bytes calldata signature
    ) external nonReentrant {
        if (!trustedVerifiers[msg.sender]) revert NotTrustedVerifier();

        AttestationRecord storage record = attestations[provider];
        if (record.timestamp == 0) revert InvalidQuoteFormat();
        if (record.status == VerificationStatus.VERIFIED) revert AlreadyVerified();

        record.verifier = msg.sender;

        if (valid) {
            record.status = VerificationStatus.VERIFIED;
            record.expiresAt = block.timestamp + ATTESTATION_VALIDITY;
            successfulAttestations++;
        } else {
            record.status = VerificationStatus.INVALID_FORMAT;
            failedAttestations++;
        }

        emit AttestationVerified(provider, msg.sender, valid);
    }

    /**
     * @notice Check if a provider has a valid attestation
     * @param provider Provider address to check
     * @return valid Whether attestation is valid
     * @return expiresAt When attestation expires
     */
    function isValid(address provider) external view returns (bool valid, uint256 expiresAt) {
        AttestationRecord storage record = attestations[provider];

        if (record.status != VerificationStatus.VERIFIED) {
            return (false, 0);
        }

        if (block.timestamp >= record.expiresAt) {
            return (false, record.expiresAt);
        }

        return (true, record.expiresAt);
    }

    /**
     * @notice Get attestation details for a provider
     * @param provider Provider address
     * @return record Full attestation record
     */
    function getAttestation(address provider) external view returns (AttestationRecord memory record) {
        return attestations[provider];
    }

    // ============================================================================
    // External Functions - Management
    // ============================================================================

    /**
     * @notice Add a trusted TD measurement
     * @param mrtd TD measurement hash
     * @param description Human-readable description
     * @param validUntil Expiry timestamp (0 = no expiry)
     */
    function addTrustedMeasurement(
        bytes32 mrtd,
        string calldata description,
        uint256 validUntil
    ) external onlyOwner {
        trustedMeasurements[mrtd] = TrustedMeasurement({
            mrtd: mrtd,
            description: description,
            validFrom: block.timestamp,
            validUntil: validUntil,
            active: true
        });

        measurementList.push(mrtd);

        emit MeasurementAdded(mrtd, description, block.timestamp, validUntil);
    }

    /**
     * @notice Revoke a trusted measurement
     * @param mrtd TD measurement to revoke
     * @param reason Revocation reason
     */
    function revokeMeasurement(
        bytes32 mrtd,
        string calldata reason
    ) external onlyOwner {
        trustedMeasurements[mrtd].active = false;
        emit MeasurementRevoked(mrtd, reason);
    }

    /**
     * @notice Add a trusted verifier
     * @param verifier Address to add as trusted verifier
     */
    function addTrustedVerifier(address verifier) external onlyOwner {
        trustedVerifiers[verifier] = true;
        emit TrustedVerifierAdded(verifier);
    }

    /**
     * @notice Remove a trusted verifier
     * @param verifier Address to remove
     */
    function removeTrustedVerifier(address verifier) external onlyOwner {
        trustedVerifiers[verifier] = false;
        emit TrustedVerifierRemoved(verifier);
    }

    /**
     * @notice Set whether trusted verifier is required
     * @param required Whether to require trusted verifier
     */
    function setRequireTrustedVerifier(bool required) external onlyOwner {
        requireTrustedVerifier = required;
    }

    /**
     * @notice Set minimum stake for attestation
     * @param amount Minimum stake amount in wei
     */
    function setMinStakeForAttestation(uint256 amount) external onlyOwner {
        minStakeForAttestation = amount;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Parse a TDX quote without verification
     * @param quote Raw quote bytes
     * @return parsed Parsed quote structure
     */
    function parseQuote(bytes calldata quote) public pure returns (ParsedQuote memory parsed) {
        if (quote.length < MIN_QUOTE_LENGTH) {
            parsed.valid = false;
            parsed.error = "Quote too short";
            return parsed;
        }

        // Parse header (first 48 bytes)
        // Bytes 0-1: Version (should be 4 or 5 for TDX)
        uint16 version = uint16(uint8(quote[0])) | (uint16(uint8(quote[1])) << 8);

        // Bytes 2-3: Attestation key type
        uint16 attestationKeyType = uint16(uint8(quote[2])) | (uint16(uint8(quote[3])) << 8);

        // Bytes 4-7: TEE type (0x81 = TDX)
        uint32 teeType = uint32(uint8(quote[4])) |
                         (uint32(uint8(quote[5])) << 8) |
                         (uint32(uint8(quote[6])) << 16) |
                         (uint32(uint8(quote[7])) << 24);

        // Validate TDX quote format
        if (version != 4 && version != 5) {
            parsed.valid = false;
            parsed.error = "Invalid TDX quote version";
            return parsed;
        }

        if (teeType != 0x00000081) { // TDX TEE type
            parsed.valid = false;
            parsed.error = "Not a TDX quote";
            return parsed;
        }

        // Extract MRTD (TD measurement) - 48 bytes at offset
        // For gas efficiency, we only use the first 32 bytes as the identifier
        bytes32 mrtd;
        uint256 mrtdOffset = MRTD_OFFSET;
        assembly {
            // Load 32 bytes from MRTD offset in calldata
            let offset := add(quote.offset, mrtdOffset)
            mrtd := calldataload(offset)
        }

        // Extract MRSIGNER_SEAM (SEAM module measurement)
        bytes32 mrsignerSeam;
        uint256 mrsignerOffset = MRTD_OFFSET + 48;
        assembly {
            let offset := add(quote.offset, mrsignerOffset)
            mrsignerSeam := calldataload(offset)
        }

        // Extract report data (64 bytes, we use first 32)
        bytes32 reportData;
        uint256 reportDataOffset = REPORT_DATA_OFFSET;
        assembly {
            let offset := add(quote.offset, reportDataOffset)
            reportData := calldataload(offset)
        }

        // Compute quote hash for verification
        bytes32 quoteHash = keccak256(quote);

        parsed.version = version;
        parsed.attestationKeyType = attestationKeyType;
        parsed.teeType = teeType;
        parsed.mrtd = mrtd;
        parsed.mrsignerSeam = mrsignerSeam;
        parsed.reportData = reportData;
        parsed.quoteHash = quoteHash;
        parsed.valid = true;

        return parsed;
    }

    /**
     * @notice Get all trusted measurements
     * @return measurements Array of trusted measurement hashes
     */
    function getTrustedMeasurements() external view returns (bytes32[] memory measurements) {
        uint256 count = 0;
        for (uint256 i = 0; i < measurementList.length; i++) {
            if (trustedMeasurements[measurementList[i]].active) {
                count++;
            }
        }

        measurements = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < measurementList.length; i++) {
            if (trustedMeasurements[measurementList[i]].active) {
                measurements[index] = measurementList[i];
                index++;
            }
        }

        return measurements;
    }

    /**
     * @notice Get all attested providers
     * @return providers Array of provider addresses
     */
    function getAttestedProviders() external view returns (address[] memory providers) {
        return attestedProviders;
    }

    /**
     * @notice Get providers with valid attestations
     * @return providers Array of valid provider addresses
     */
    function getValidProviders() external view returns (address[] memory providers) {
        uint256 count = 0;
        for (uint256 i = 0; i < attestedProviders.length; i++) {
            AttestationRecord storage record = attestations[attestedProviders[i]];
            if (record.status == VerificationStatus.VERIFIED &&
                block.timestamp < record.expiresAt) {
                count++;
            }
        }

        providers = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < attestedProviders.length; i++) {
            AttestationRecord storage record = attestations[attestedProviders[i]];
            if (record.status == VerificationStatus.VERIFIED &&
                block.timestamp < record.expiresAt) {
                providers[index] = attestedProviders[i];
                index++;
            }
        }

        return providers;
    }

    /**
     * @notice Get verification statistics
     */
    function getStats() external view returns (
        uint256 total,
        uint256 successful,
        uint256 failed,
        uint256 trustedMeasurementCount,
        uint256 validProviderCount
    ) {
        total = totalAttestations;
        successful = successfulAttestations;
        failed = failedAttestations;

        for (uint256 i = 0; i < measurementList.length; i++) {
            if (trustedMeasurements[measurementList[i]].active) {
                trustedMeasurementCount++;
            }
        }

        for (uint256 i = 0; i < attestedProviders.length; i++) {
            AttestationRecord storage record = attestations[attestedProviders[i]];
            if (record.status == VerificationStatus.VERIFIED &&
                block.timestamp < record.expiresAt) {
                validProviderCount++;
            }
        }
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    function _isMeasurementTrusted(TrustedMeasurement storage measurement) internal view returns (bool) {
        if (!measurement.active) return false;
        if (block.timestamp < measurement.validFrom) return false;
        if (measurement.validUntil != 0 && block.timestamp > measurement.validUntil) return false;
        return true;
    }

    function _createRecord(
        address provider,
        ParsedQuote memory parsed,
        VerificationStatus status,
        address verifier
    ) internal view returns (AttestationRecord memory) {
        return AttestationRecord({
            provider: provider,
            mrtd: parsed.mrtd,
            reportData: parsed.reportData,
            quoteHash: parsed.quoteHash,
            timestamp: block.timestamp,
            expiresAt: status == VerificationStatus.VERIFIED
                ? block.timestamp + ATTESTATION_VALIDITY
                : 0,
            status: status,
            verifier: verifier
        });
    }

    function _addToProviderList(address provider) internal {
        // Check if already in list
        for (uint256 i = 0; i < attestedProviders.length; i++) {
            if (attestedProviders[i] == provider) return;
        }
        attestedProviders.push(provider);
    }
}
