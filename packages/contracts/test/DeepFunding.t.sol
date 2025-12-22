// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ContributorRegistry} from "../src/funding/ContributorRegistry.sol";
import {PaymentRequestRegistry} from "../src/funding/PaymentRequestRegistry.sol";
import {WorkAgreementRegistry} from "../src/funding/WorkAgreementRegistry.sol";
import {DeepFundingDistributor} from "../src/funding/DeepFundingDistributor.sol";

/**
 * @title DeepFundingTest
 * @notice Tests for the deep funding system contracts
 */
contract DeepFundingTest is Test {
    // ============ Contracts ============

    ContributorRegistry public contributorRegistry;
    PaymentRequestRegistry public paymentRequestRegistry;
    WorkAgreementRegistry public workAgreementRegistry;
    DeepFundingDistributor public distributor;

    // ============ Test Accounts ============

    address public owner = address(0x1);
    address public verifier = address(0x2);
    address public contributor1 = address(0x3);
    address public contributor2 = address(0x4);
    address public daoAdmin = address(0x5);
    address public jejuTreasury = address(0x6);

    bytes32 public constant DAO_ID = keccak256("jeju");

    // ============ Setup ============

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock identity registry (simplified)
        address mockIdentityRegistry = address(0x100);

        // Deploy contributor registry
        contributorRegistry = new ContributorRegistry(
            mockIdentityRegistry,
            verifier,
            owner
        );

        // Deploy distributor
        distributor = new DeepFundingDistributor(
            address(0), // Mock DAO registry
            jejuTreasury,
            address(contributorRegistry),
            owner
        );

        vm.stopPrank();
    }

    // ============ ContributorRegistry Tests ============

    function test_RegisterIndividual() public {
        vm.prank(contributor1);

        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributor(contributorId);

        assertEq(contrib.wallet, contributor1);
        assertEq(uint256(contrib.contributorType), uint256(ContributorRegistry.ContributorType.INDIVIDUAL));
        assertTrue(contrib.active);
    }

    function test_RegisterOrganization() public {
        vm.prank(contributor1);

        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.ORGANIZATION,
            "ipfs://QmOrg"
        );

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributor(contributorId);

        assertEq(uint256(contrib.contributorType), uint256(ContributorRegistry.ContributorType.ORGANIZATION));
    }

    function test_RegisterProject() public {
        vm.prank(contributor1);

        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.PROJECT,
            "ipfs://QmProject"
        );

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributor(contributorId);

        assertEq(uint256(contrib.contributorType), uint256(ContributorRegistry.ContributorType.PROJECT));
    }

    function test_RevertDoubleRegistration() public {
        vm.startPrank(contributor1);

        contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.expectRevert(ContributorRegistry.AlreadyRegistered.selector);
        contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile2"
        );

        vm.stopPrank();
    }

    function test_AddSocialLink() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        contributorRegistry.addSocialLink(
            contributorId,
            keccak256("github"),
            "testuser"
        );

        ContributorRegistry.SocialLink[] memory links =
            contributorRegistry.getSocialLinks(contributorId);

        assertEq(links.length, 1);
        assertEq(links[0].handle, "testuser");
        assertEq(uint256(links[0].status), uint256(ContributorRegistry.VerificationStatus.PENDING));
    }

    function test_VerifySocialLink() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        contributorRegistry.addSocialLink(
            contributorId,
            keccak256("github"),
            "testuser"
        );

        vm.prank(verifier);
        contributorRegistry.verifySocialLink(
            contributorId,
            keccak256("github"),
            keccak256("proof")
        );

        ContributorRegistry.SocialLink[] memory links =
            contributorRegistry.getSocialLinks(contributorId);

        assertEq(uint256(links[0].status), uint256(ContributorRegistry.VerificationStatus.VERIFIED));
    }

    function test_ClaimRepository() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        bytes32 claimId = contributorRegistry.claimRepository(
            contributorId,
            "jeju-network",
            "jeju"
        );

        ContributorRegistry.RepositoryClaim[] memory claims =
            contributorRegistry.getRepositoryClaims(contributorId);

        assertEq(claims.length, 1);
        assertEq(claims[0].owner, "jeju-network");
        assertEq(claims[0].repo, "jeju");
        assertEq(uint256(claims[0].status), uint256(ContributorRegistry.VerificationStatus.PENDING));
    }

    function test_VerifyRepository() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        bytes32 claimId = contributorRegistry.claimRepository(
            contributorId,
            "jeju-network",
            "jeju"
        );

        vm.prank(verifier);
        contributorRegistry.verifyRepository(claimId, keccak256("repoProof"));

        bytes32 foundContributor = contributorRegistry.getContributorForRepo(
            "jeju-network",
            "jeju"
        );

        assertEq(foundContributor, contributorId);
    }

    function test_ClaimDependency() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        bytes32 claimId = contributorRegistry.claimDependency(
            contributorId,
            "viem",
            "npm"
        );

        ContributorRegistry.DependencyClaim[] memory claims =
            contributorRegistry.getDependencyClaims(contributorId);

        assertEq(claims.length, 1);
        assertEq(claims[0].packageName, "viem");
        assertEq(claims[0].registryType, "npm");
    }

    function test_DeactivateContributor() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        contributorRegistry.deactivate(contributorId);

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributor(contributorId);

        assertFalse(contrib.active);
    }

    function test_ReactivateContributor() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        contributorRegistry.deactivate(contributorId);

        vm.prank(contributor1);
        contributorRegistry.reactivate(contributorId);

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributor(contributorId);

        assertTrue(contrib.active);
    }

    // ============ DeepFundingDistributor Tests ============

    function test_DefaultConfig() public view {
        (
            uint256 treasuryBps,
            uint256 contributorPoolBps,
            uint256 dependencyPoolBps,
            uint256 jejuBps,
            uint256 burnBps,
            uint256 reserveBps
        ) = distributor.defaultConfig();

        assertEq(treasuryBps, 3000);
        assertEq(contributorPoolBps, 4000);
        assertEq(dependencyPoolBps, 2000);
        assertEq(jejuBps, 500);
        assertEq(reserveBps, 500);

        uint256 total = treasuryBps +
                       contributorPoolBps +
                       dependencyPoolBps +
                       jejuBps +
                       burnBps +
                       reserveBps;

        assertEq(total, 10000);
    }

    function test_AuthorizeDepositor() public {
        vm.prank(owner);
        distributor.authorizeDepositor(contributor1, true);

        assertTrue(distributor.authorizedDepositors(contributor1));
    }

    function test_DepthDecay() public pure {
        // Test depth decay calculation
        uint256 weight = 1000;
        uint256 DEPTH_DECAY_BPS = 2000;
        uint256 MAX_BPS = 10000;

        // Depth 0 = no decay
        uint256 depth0 = weight;
        assertEq(depth0, 1000);

        // Depth 1 = 20% decay = 80% remaining
        uint256 decayFactor1 = (MAX_BPS * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS;
        uint256 depth1 = (weight * decayFactor1) / MAX_BPS;
        assertEq(depth1, 800);

        // Depth 2 = compounded
        uint256 decayFactor2 = (decayFactor1 * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS;
        uint256 depth2 = (weight * decayFactor2) / MAX_BPS;
        assertEq(depth2, 640);
    }

    function test_SupermajorityCalculation() public pure {
        uint256 SUPERMAJORITY_BPS = 6700; // 67%

        // 3 approve, 0 reject = 100% = supermajority
        uint256 approves1 = 3;
        uint256 rejects1 = 0;
        uint256 total1 = approves1 + rejects1;
        assertTrue(total1 > 0 && (approves1 * 10000 / total1) > SUPERMAJORITY_BPS);

        // 3 approve, 1 reject = 75% = supermajority
        uint256 approves2 = 3;
        uint256 rejects2 = 1;
        uint256 total2 = approves2 + rejects2;
        assertTrue((approves2 * 10000 / total2) > SUPERMAJORITY_BPS);

        // 2 approve, 1 reject = 66.7% = NOT supermajority
        uint256 approves3 = 2;
        uint256 rejects3 = 1;
        uint256 total3 = approves3 + rejects3;
        assertFalse((approves3 * 10000 / total3) > SUPERMAJORITY_BPS);
    }

    // ============ Edge Cases ============

    function test_RevertUnauthorizedVerification() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor1);
        contributorRegistry.addSocialLink(
            contributorId,
            keccak256("github"),
            "testuser"
        );

        // Random address tries to verify
        vm.prank(address(0x999));
        vm.expectRevert(ContributorRegistry.NotVerifier.selector);
        contributorRegistry.verifySocialLink(
            contributorId,
            keccak256("github"),
            keccak256("proof")
        );
    }

    function test_RevertNonOwnerActions() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        // Different address tries to update profile
        vm.prank(contributor2);
        vm.expectRevert(ContributorRegistry.NotContributorOwner.selector);
        contributorRegistry.updateProfile(contributorId, "ipfs://QmNew");
    }

    function test_GetContributorByWallet() public {
        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        ContributorRegistry.Contributor memory contrib =
            contributorRegistry.getContributorByWallet(contributor1);

        assertEq(contrib.contributorId, contributorId);
        assertEq(contrib.wallet, contributor1);
    }

    function test_GetContributorCount() public {
        vm.prank(contributor1);
        contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        vm.prank(contributor2);
        contributorRegistry.register(
            ContributorRegistry.ContributorType.ORGANIZATION,
            "ipfs://QmProfile2"
        );

        assertEq(contributorRegistry.getContributorCount(), 2);
    }

    function test_IsVerifiedGitHub() public {
        bytes32 GITHUB_PLATFORM = keccak256("github");

        vm.prank(contributor1);
        bytes32 contributorId = contributorRegistry.register(
            ContributorRegistry.ContributorType.INDIVIDUAL,
            "ipfs://QmProfile1"
        );

        // Not verified initially
        assertFalse(contributorRegistry.isVerifiedGitHub(contributorId));

        vm.prank(contributor1);
        contributorRegistry.addSocialLink(
            contributorId,
            GITHUB_PLATFORM,
            "testuser"
        );

        vm.prank(verifier);
        contributorRegistry.verifySocialLink(
            contributorId,
            GITHUB_PLATFORM,
            keccak256("proof")
        );

        // Now verified
        assertTrue(contributorRegistry.isVerifiedGitHub(contributorId));
    }

    // ============ Fuzz Tests ============

    function testFuzz_DepthDecay(uint256 baseWeight, uint8 depth) public pure {
        vm.assume(baseWeight >= 10 && baseWeight <= 10000);
        vm.assume(depth <= 5);

        uint256 DEPTH_DECAY_BPS = 2000;
        uint256 MAX_BPS = 10000;

        uint256 decayFactor = MAX_BPS;
        for (uint256 i = 0; i < depth; i++) {
            decayFactor = (decayFactor * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS;
        }

        uint256 decayedWeight = (baseWeight * decayFactor) / MAX_BPS;

        // Decayed weight should always be <= original
        assertTrue(decayedWeight <= baseWeight);

        // Decayed weight should be > 0 for reasonable depths
        assertTrue(decayedWeight > 0);
    }

    function testFuzz_WeightNormalization(uint256[] calldata weights) public pure {
        vm.assume(weights.length > 0 && weights.length <= 10);

        uint256 total = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            // Bound individual weights to prevent overflow
            uint256 w = weights[i] % 10000;
            total += w;
        }

        if (total == 0) return;

        uint256 normalizedSum = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            uint256 w = weights[i] % 10000;
            normalizedSum += (w * 10000) / total;
        }

        // Normalized sum should be close to MAX_BPS (allowing rounding)
        assertTrue(normalizedSum <= 10000);
    }
}

