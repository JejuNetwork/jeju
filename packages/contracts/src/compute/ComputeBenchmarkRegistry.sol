// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ComputeRegistry} from "./ComputeRegistry.sol";

/**
 * @title ComputeBenchmarkRegistry
 * @author Jeju Network
 * @notice On-chain registry for compute provider benchmark results
 * @dev Stores performance attestations and enables cost-per-performance ranking
 *
 * Benchmark Categories:
 * - CPU: Multi-core performance, single-thread, compression
 * - Memory: Bandwidth, latency
 * - Disk: Sequential/random IOPS, throughput
 * - Network: Bandwidth, latency
 * - GPU: FLOPS, memory bandwidth, inference latency
 * - TEE: Attestation validity, enclave size
 *
 * Trust Model:
 * - Benchmarks can be self-reported or verified
 * - Verified benchmarks require signature from authorized verifier
 * - TEE attestations are cryptographically verifiable
 * - Reputation affects weight of self-reported benchmarks
 */
contract ComputeBenchmarkRegistry is Ownable, ReentrancyGuard {
    // ============ Enums ============

    enum BenchmarkCategory {
        CPU,
        Memory,
        Disk,
        Network,
        GPU,
        TEE
    }

    enum VerificationStatus {
        Pending,
        SelfReported,
        Verified,
        Disputed,
        Rejected
    }

    enum TEEType {
        None,
        IntelSGX,
        AMDSEV,
        ArmTrustZone,
        NitroEnclave,
        IntelTDX
    }

    // ============ Structs ============

    struct CPUBenchmark {
        uint32 coreCount;
        uint32 threadCount;
        uint64 singleThreadScore;    // Normalized 0-100000
        uint64 multiThreadScore;     // Normalized 0-100000
        uint64 compressionScore;     // MB/s
        string cpuModel;             // e.g., "AMD EPYC 7763"
        uint64 clockSpeedMhz;
    }

    struct MemoryBenchmark {
        uint64 capacityMb;
        uint64 bandwidthMbps;        // Read bandwidth
        uint64 writeBandwidthMbps;
        uint32 latencyNs;
        string memoryType;           // e.g., "DDR5-4800"
    }

    struct DiskBenchmark {
        uint64 capacityGb;
        uint64 seqReadMbps;
        uint64 seqWriteMbps;
        uint32 randReadIops;
        uint32 randWriteIops;
        string diskType;             // e.g., "NVMe SSD"
    }

    struct NetworkBenchmark {
        uint64 bandwidthMbps;
        uint32 latencyMs;
        uint64 uploadMbps;
        string region;               // e.g., "us-east-1"
        bool ipv6Supported;
    }

    struct GPUBenchmark {
        string model;                // e.g., "NVIDIA H100"
        uint64 vramMb;
        uint64 fp32Tflops;           // in 0.01 TFLOPS
        uint64 fp16Tflops;
        uint64 memoryBandwidthGbps;
        uint64 inferenceLatencyMs;   // Time for standard benchmark inference
        uint32 cudaCores;
        uint32 tensorCores;
    }

    struct TEEBenchmark {
        TEEType teeType;
        bytes32 attestationHash;
        uint64 maxEnclaveMemoryMb;
        bool remoteAttestationSupported;
        uint64 lastAttestationTimestamp;
        bytes attestationQuote;      // Raw attestation quote for verification
    }

    struct BenchmarkResult {
        address provider;
        uint64 timestamp;
        VerificationStatus status;
        address verifier;
        bytes32 benchmarkHash;       // Hash of all benchmark data for integrity
        uint64 overallScore;         // Weighted composite score 0-100000
        uint64 costPerScore;         // Wei per score unit per hour
    }

    struct ProviderBenchmarks {
        CPUBenchmark cpu;
        MemoryBenchmark memory_;     // memory is reserved keyword
        DiskBenchmark disk;
        NetworkBenchmark network;
        GPUBenchmark gpu;
        TEEBenchmark tee;
        BenchmarkResult result;
    }

    // ============ State ============

    /// @notice Compute registry for provider verification
    ComputeRegistry public computeRegistry;

    /// @notice Provider benchmarks
    mapping(address => ProviderBenchmarks) public providerBenchmarks;

    /// @notice Authorized benchmark verifiers
    mapping(address => bool) public authorizedVerifiers;

    /// @notice TEE attestation verifiers by TEE type
    mapping(TEEType => address) public teeVerifiers;

    /// @notice All providers with benchmarks
    address[] public benchmarkedProviders;
    mapping(address => uint256) internal providerIndex;

    /// @notice Category weights for overall score (basis points, total = 10000)
    mapping(BenchmarkCategory => uint16) public categoryWeights;

    /// @notice Minimum benchmark validity period
    uint64 public benchmarkValidityPeriod = 30 days;

    /// @notice Events
    event BenchmarkSubmitted(
        address indexed provider,
        bytes32 benchmarkHash,
        uint64 overallScore,
        VerificationStatus status
    );
    event BenchmarkVerified(
        address indexed provider,
        address indexed verifier,
        VerificationStatus newStatus
    );
    event TEEAttestationVerified(
        address indexed provider,
        TEEType teeType,
        bytes32 attestationHash
    );
    event VerifierUpdated(address indexed verifier, bool authorized);
    event TEEVerifierUpdated(TEEType indexed teeType, address verifier);
    event CategoryWeightUpdated(BenchmarkCategory indexed category, uint16 weight);

    /// @notice Errors
    error ProviderNotRegistered();
    error NotAuthorizedVerifier();
    error BenchmarkNotFound();
    error InvalidBenchmarkData();
    error BenchmarkExpired();
    error InvalidCategoryWeights();
    error AttestationVerificationFailed();
    error DisputeAlreadyExists();
    error InvalidDisputeReason();

    /// @notice Dispute structure
    struct Dispute {
        address disputer;
        uint64 timestamp;
        string reason;
        bool resolved;
        bool upheld; // If true, benchmark was found to be fraudulent
    }

    /// @notice Provider disputes
    mapping(address => Dispute[]) public providerDisputes;

    /// @notice Dispute events
    event BenchmarkDisputed(
        address indexed provider,
        address indexed disputer,
        string reason,
        uint256 disputeIndex
    );
    event DisputeResolved(
        address indexed provider,
        uint256 disputeIndex,
        bool upheld
    );

    // ============ Modifiers ============

    modifier onlyVerifier() {
        if (!authorizedVerifiers[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedVerifier();
        }
        _;
    }

    modifier providerExists(address provider) {
        ComputeRegistry.Provider memory p = computeRegistry.getProvider(provider);
        if (p.registeredAt == 0) revert ProviderNotRegistered();
        _;
    }

    // ============ Constructor ============

    constructor(address _computeRegistry, address initialOwner) Ownable(initialOwner) {
        computeRegistry = ComputeRegistry(_computeRegistry);
        authorizedVerifiers[initialOwner] = true;

        // Set default category weights (total = 10000)
        categoryWeights[BenchmarkCategory.CPU] = 2500;      // 25%
        categoryWeights[BenchmarkCategory.Memory] = 1500;   // 15%
        categoryWeights[BenchmarkCategory.Disk] = 1000;     // 10%
        categoryWeights[BenchmarkCategory.Network] = 1500;  // 15%
        categoryWeights[BenchmarkCategory.GPU] = 2500;      // 25%
        categoryWeights[BenchmarkCategory.TEE] = 1000;      // 10%
    }

    // ============ Benchmark Submission ============

    /**
     * @notice Submit benchmark results for a provider
     * @param cpu CPU benchmark data
     * @param memory_ Memory benchmark data
     * @param disk Disk benchmark data
     * @param network Network benchmark data
     * @param gpu GPU benchmark data (optional - set model to empty for no GPU)
     * @param tee TEE benchmark data (optional - set teeType to None)
     */
    function submitBenchmark(
        CPUBenchmark calldata cpu,
        MemoryBenchmark calldata memory_,
        DiskBenchmark calldata disk,
        NetworkBenchmark calldata network,
        GPUBenchmark calldata gpu,
        TEEBenchmark calldata tee
    ) external nonReentrant providerExists(msg.sender) {
        // Store benchmarks
        ProviderBenchmarks storage benchmarks = providerBenchmarks[msg.sender];
        benchmarks.cpu = cpu;
        benchmarks.memory_ = memory_;
        benchmarks.disk = disk;
        benchmarks.network = network;
        benchmarks.gpu = gpu;
        benchmarks.tee = tee;

        // Calculate overall score
        uint64 score = _calculateOverallScore(cpu, memory_, disk, network, gpu, tee);

        // Cost per score is computed off-chain from rental pricing
        // The ComputeRegistry.Provider doesn't store pricing directly
        uint64 costPerScore = 0;

        // Create benchmark hash
        bytes32 benchmarkHash = keccak256(abi.encode(
            cpu, memory_, disk, network, gpu, tee.teeType, tee.attestationHash
        ));

        // Store result
        benchmarks.result = BenchmarkResult({
            provider: msg.sender,
            timestamp: uint64(block.timestamp),
            status: VerificationStatus.SelfReported,
            verifier: address(0),
            benchmarkHash: benchmarkHash,
            overallScore: score,
            costPerScore: costPerScore
        });

        // Track provider
        if (providerIndex[msg.sender] == 0) {
            benchmarkedProviders.push(msg.sender);
            providerIndex[msg.sender] = benchmarkedProviders.length;
        }

        emit BenchmarkSubmitted(msg.sender, benchmarkHash, score, VerificationStatus.SelfReported);
    }

    /**
     * @notice Verify a provider's benchmark
     * @param provider Provider address
     * @param status New verification status
     */
    function verifyBenchmark(
        address provider,
        VerificationStatus status
    ) external onlyVerifier {
        ProviderBenchmarks storage benchmarks = providerBenchmarks[provider];
        if (benchmarks.result.timestamp == 0) revert BenchmarkNotFound();

        benchmarks.result.status = status;
        benchmarks.result.verifier = msg.sender;

        emit BenchmarkVerified(provider, msg.sender, status);
    }

    /**
     * @notice Dispute a provider's benchmark as potentially fraudulent
     * @param provider Provider address
     * @param reason Reason for the dispute
     * @return disputeIndex Index of the created dispute
     */
    function disputeBenchmark(
        address provider,
        string calldata reason
    ) external returns (uint256 disputeIndex) {
        ProviderBenchmarks storage benchmarks = providerBenchmarks[provider];
        if (benchmarks.result.timestamp == 0) revert BenchmarkNotFound();
        if (bytes(reason).length == 0) revert InvalidDisputeReason();

        // Create dispute
        disputeIndex = providerDisputes[provider].length;
        providerDisputes[provider].push(Dispute({
            disputer: msg.sender,
            timestamp: uint64(block.timestamp),
            reason: reason,
            resolved: false,
            upheld: false
        }));

        // Mark benchmark as disputed
        benchmarks.result.status = VerificationStatus.Disputed;

        emit BenchmarkDisputed(provider, msg.sender, reason, disputeIndex);
    }

    /**
     * @notice Resolve a dispute (owner/verifier only)
     * @param provider Provider address
     * @param disputeIndex Index of the dispute
     * @param upheld Whether the dispute was upheld (benchmark is fraudulent)
     */
    function resolveDispute(
        address provider,
        uint256 disputeIndex,
        bool upheld
    ) external onlyVerifier {
        if (disputeIndex >= providerDisputes[provider].length) {
            revert BenchmarkNotFound();
        }

        Dispute storage dispute = providerDisputes[provider][disputeIndex];
        dispute.resolved = true;
        dispute.upheld = upheld;

        ProviderBenchmarks storage benchmarks = providerBenchmarks[provider];
        
        if (upheld) {
            // Dispute upheld - benchmark is fraudulent
            benchmarks.result.status = VerificationStatus.Rejected;
        } else {
            // Dispute not upheld - restore to self-reported or verified
            benchmarks.result.status = benchmarks.result.verifier != address(0) 
                ? VerificationStatus.Verified 
                : VerificationStatus.SelfReported;
        }

        emit DisputeResolved(provider, disputeIndex, upheld);
    }

    /**
     * @notice Get disputes for a provider
     * @param provider Provider address
     * @return disputes Array of disputes
     */
    function getDisputes(address provider) external view returns (Dispute[] memory) {
        return providerDisputes[provider];
    }

    /**
     * @notice Verify TEE attestation
     * @param provider Provider address
     * @param attestationQuote Raw attestation quote
     * @param expectedHash Expected attestation hash
     */
    function verifyTEEAttestation(
        address provider,
        bytes calldata attestationQuote,
        bytes32 expectedHash
    ) external {
        ProviderBenchmarks storage benchmarks = providerBenchmarks[provider];
        if (benchmarks.result.timestamp == 0) revert BenchmarkNotFound();

        TEEType teeType = benchmarks.tee.teeType;
        address verifier = teeVerifiers[teeType];

        // If no specific verifier, only owner/authorized can verify
        if (verifier == address(0)) {
            if (!authorizedVerifiers[msg.sender] && msg.sender != owner()) {
                revert NotAuthorizedVerifier();
            }
        } else {
            // Call TEE-specific verifier contract
            (bool success, bytes memory result) = verifier.staticcall(
                abi.encodeWithSignature(
                    "verifyAttestation(bytes,bytes32)",
                    attestationQuote,
                    expectedHash
                )
            );
            if (!success || (result.length > 0 && !abi.decode(result, (bool)))) {
                revert AttestationVerificationFailed();
            }
        }

        // Update attestation
        benchmarks.tee.attestationQuote = attestationQuote;
        benchmarks.tee.attestationHash = expectedHash;
        benchmarks.tee.lastAttestationTimestamp = uint64(block.timestamp);

        // Upgrade verification status if currently self-reported
        if (benchmarks.result.status == VerificationStatus.SelfReported) {
            benchmarks.result.status = VerificationStatus.Verified;
            benchmarks.result.verifier = msg.sender;
        }

        emit TEEAttestationVerified(provider, teeType, expectedHash);
    }

    // ============ Query Functions ============

    /**
     * @notice Get benchmark results for a provider
     */
    function getBenchmark(address provider) 
        external 
        view 
        returns (ProviderBenchmarks memory) 
    {
        return providerBenchmarks[provider];
    }

    /**
     * @notice Get overall score for a provider
     */
    function getScore(address provider) external view returns (uint64) {
        return providerBenchmarks[provider].result.overallScore;
    }

    /**
     * @notice Check if benchmark is still valid
     */
    function isBenchmarkValid(address provider) external view returns (bool) {
        BenchmarkResult storage result = providerBenchmarks[provider].result;
        if (result.timestamp == 0) return false;
        return block.timestamp - result.timestamp <= benchmarkValidityPeriod;
    }

    /**
     * @notice Get providers ranked by score
     * @param minScore Minimum score threshold
     * @param maxCount Maximum number to return
     * @param requireVerified Only include verified benchmarks
     * @param requireTEE Only include providers with TEE
     * @param requireGPU Only include providers with GPU
     */
    function getRankedProviders(
        uint64 minScore,
        uint16 maxCount,
        bool requireVerified,
        bool requireTEE,
        bool requireGPU
    ) external view returns (address[] memory providers, uint64[] memory scores) {
        // Count eligible
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < benchmarkedProviders.length; i++) {
            if (_isEligible(
                benchmarkedProviders[i], 
                minScore, 
                requireVerified, 
                requireTEE, 
                requireGPU
            )) {
                eligibleCount++;
            }
        }

        if (eligibleCount == 0) {
            return (new address[](0), new uint64[](0));
        }

        // Collect eligible
        address[] memory eligible = new address[](eligibleCount);
        uint64[] memory eligibleScores = new uint64[](eligibleCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < benchmarkedProviders.length; i++) {
            address p = benchmarkedProviders[i];
            if (_isEligible(p, minScore, requireVerified, requireTEE, requireGPU)) {
                eligible[idx] = p;
                eligibleScores[idx] = providerBenchmarks[p].result.overallScore;
                idx++;
            }
        }

        // Sort by score descending (insertion sort)
        for (uint256 i = 1; i < eligibleCount; i++) {
            uint256 j = i;
            while (j > 0 && eligibleScores[j - 1] < eligibleScores[j]) {
                (eligibleScores[j - 1], eligibleScores[j]) = (eligibleScores[j], eligibleScores[j - 1]);
                (eligible[j - 1], eligible[j]) = (eligible[j], eligible[j - 1]);
                j--;
            }
        }

        // Return top N
        uint256 resultCount = maxCount > eligibleCount ? eligibleCount : maxCount;
        providers = new address[](resultCount);
        scores = new uint64[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            providers[i] = eligible[i];
            scores[i] = eligibleScores[i];
        }
    }

    /**
     * @notice Get providers ranked by cost efficiency (lowest cost per score)
     * @param minScore Minimum score threshold
     * @param maxCount Maximum number to return
     */
    function getCostEfficientProviders(
        uint64 minScore,
        uint16 maxCount
    ) external view returns (address[] memory providers, uint64[] memory costPerScores) {
        // Count eligible
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < benchmarkedProviders.length; i++) {
            address p = benchmarkedProviders[i];
            BenchmarkResult storage result = providerBenchmarks[p].result;
            if (result.overallScore >= minScore && result.costPerScore > 0) {
                eligibleCount++;
            }
        }

        if (eligibleCount == 0) {
            return (new address[](0), new uint64[](0));
        }

        // Collect eligible
        address[] memory eligible = new address[](eligibleCount);
        uint64[] memory costs = new uint64[](eligibleCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < benchmarkedProviders.length; i++) {
            address p = benchmarkedProviders[i];
            BenchmarkResult storage result = providerBenchmarks[p].result;
            if (result.overallScore >= minScore && result.costPerScore > 0) {
                eligible[idx] = p;
                costs[idx] = result.costPerScore;
                idx++;
            }
        }

        // Sort by cost ascending
        for (uint256 i = 1; i < eligibleCount; i++) {
            uint256 j = i;
            while (j > 0 && costs[j - 1] > costs[j]) {
                (costs[j - 1], costs[j]) = (costs[j], costs[j - 1]);
                (eligible[j - 1], eligible[j]) = (eligible[j], eligible[j - 1]);
                j--;
            }
        }

        // Return top N
        uint256 resultCount = maxCount > eligibleCount ? eligibleCount : maxCount;
        providers = new address[](resultCount);
        costPerScores = new uint64[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            providers[i] = eligible[i];
            costPerScores[i] = costs[i];
        }
    }

    /**
     * @notice Get total benchmarked provider count
     */
    function getBenchmarkedProviderCount() external view returns (uint256) {
        return benchmarkedProviders.length;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set verifier authorization
     */
    function setVerifier(address verifier, bool authorized) external onlyOwner {
        authorizedVerifiers[verifier] = authorized;
        emit VerifierUpdated(verifier, authorized);
    }

    /**
     * @notice Set TEE-specific verifier contract
     */
    function setTEEVerifier(TEEType teeType, address verifier) external onlyOwner {
        teeVerifiers[teeType] = verifier;
        emit TEEVerifierUpdated(teeType, verifier);
    }

    /**
     * @notice Set category weight
     */
    function setCategoryWeight(BenchmarkCategory category, uint16 weight) external onlyOwner {
        categoryWeights[category] = weight;
        emit CategoryWeightUpdated(category, weight);
    }

    /**
     * @notice Set benchmark validity period
     */
    function setBenchmarkValidityPeriod(uint64 period) external onlyOwner {
        benchmarkValidityPeriod = period;
    }

    /**
     * @notice Update compute registry
     */
    function setComputeRegistry(address _computeRegistry) external onlyOwner {
        computeRegistry = ComputeRegistry(_computeRegistry);
    }

    // ============ Internal Functions ============

    function _calculateOverallScore(
        CPUBenchmark calldata cpu,
        MemoryBenchmark calldata memory_,
        DiskBenchmark calldata disk,
        NetworkBenchmark calldata network,
        GPUBenchmark calldata gpu,
        TEEBenchmark calldata tee
    ) internal view returns (uint64) {
        uint256 totalWeight = 0;
        uint256 weightedScore = 0;

        // CPU score (normalize multiThreadScore to 0-100)
        uint256 cpuScore = cpu.multiThreadScore > 100000 ? 100 : (cpu.multiThreadScore * 100) / 100000;
        weightedScore += cpuScore * categoryWeights[BenchmarkCategory.CPU];
        totalWeight += categoryWeights[BenchmarkCategory.CPU];

        // Memory score (normalize bandwidth to 0-100, based on 100Gbps max)
        uint256 memScore = memory_.bandwidthMbps > 100000 ? 100 : (memory_.bandwidthMbps * 100) / 100000;
        weightedScore += memScore * categoryWeights[BenchmarkCategory.Memory];
        totalWeight += categoryWeights[BenchmarkCategory.Memory];

        // Disk score (normalize sequential read to 0-100, based on 10Gbps max)
        uint256 diskScore = disk.seqReadMbps > 10000 ? 100 : (disk.seqReadMbps * 100) / 10000;
        weightedScore += diskScore * categoryWeights[BenchmarkCategory.Disk];
        totalWeight += categoryWeights[BenchmarkCategory.Disk];

        // Network score (normalize bandwidth to 0-100, based on 25Gbps max)
        uint256 netScore = network.bandwidthMbps > 25000 ? 100 : (network.bandwidthMbps * 100) / 25000;
        weightedScore += netScore * categoryWeights[BenchmarkCategory.Network];
        totalWeight += categoryWeights[BenchmarkCategory.Network];

        // GPU score (only if GPU exists)
        if (bytes(gpu.model).length > 0 && gpu.fp32Tflops > 0) {
            // Normalize fp32 TFLOPS to 0-100, based on 100 TFLOPS max
            uint256 gpuScore = gpu.fp32Tflops > 10000 ? 100 : (gpu.fp32Tflops * 100) / 10000;
            weightedScore += gpuScore * categoryWeights[BenchmarkCategory.GPU];
            totalWeight += categoryWeights[BenchmarkCategory.GPU];
        }

        // TEE score (only if TEE exists)
        if (tee.teeType != TEEType.None) {
            // TEE score based on type and attestation
            uint256 teeScore = 50; // Base score for having TEE
            if (tee.remoteAttestationSupported) teeScore += 25;
            if (tee.lastAttestationTimestamp > 0) teeScore += 25;
            weightedScore += teeScore * categoryWeights[BenchmarkCategory.TEE];
            totalWeight += categoryWeights[BenchmarkCategory.TEE];
        }

        if (totalWeight == 0) return 0;

        // Return normalized score (0-100000 for precision)
        return uint64((weightedScore * 1000) / totalWeight);
    }

    function _isEligible(
        address provider,
        uint64 minScore,
        bool requireVerified,
        bool requireTEE,
        bool requireGPU
    ) internal view returns (bool) {
        ProviderBenchmarks storage b = providerBenchmarks[provider];
        BenchmarkResult storage result = b.result;

        // Check validity
        if (result.timestamp == 0) return false;
        if (block.timestamp - result.timestamp > benchmarkValidityPeriod) return false;

        // Check score
        if (result.overallScore < minScore) return false;

        // Check verification status
        if (requireVerified && result.status != VerificationStatus.Verified) return false;

        // Check TEE
        if (requireTEE && b.tee.teeType == TEEType.None) return false;

        // Check GPU
        if (requireGPU && bytes(b.gpu.model).length == 0) return false;

        return true;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
