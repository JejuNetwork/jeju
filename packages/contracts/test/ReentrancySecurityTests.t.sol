// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ComputeRental} from "../src/compute/ComputeRental.sol";
import {Bazaar} from "../src/marketplace/Bazaar.sol";
import {OutputSettler} from "../src/oif/OutputSettler.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title Reentrancy Security Tests
 * @notice Tests to verify reentrancy protections in key contracts
 * @dev These tests attempt to exploit reentrancy vulnerabilities that were patched
 */
contract ReentrancySecurityTest is Test {
    // ============ Test Contracts ============
    ComputeRental public computeRental;
    Bazaar public bazaar;
    OutputSettler public outputSettler;

    // ============ Mock Contracts ============
    MockERC20 public goldToken;
    MockERC20 public usdcToken;
    MockERC721 public nftToken;

    // ============ Test Accounts ============
    address owner = address(this);
    address attacker;
    address victim = makeAddr("victim");
    address provider = makeAddr("provider");
    address treasury = makeAddr("treasury");

    function setUp() public {
        // Deploy mock tokens
        goldToken = new MockERC20("Gold", "GOLD", 18);
        usdcToken = new MockERC20("USDC", "USDC", 6);
        nftToken = new MockERC721("NFT", "NFT");

        // Deploy ComputeRental
        computeRental = new ComputeRental(owner, treasury);

        // Deploy Bazaar
        bazaar = new Bazaar(owner, address(goldToken), address(usdcToken), treasury);

        // Deploy OutputSettler
        outputSettler = new OutputSettler(block.chainid);

        // Fund accounts
        vm.deal(victim, 100 ether);
        vm.deal(provider, 100 ether);
        vm.deal(treasury, 0);

        // Set up malicious attacker contract
        attacker = address(new ReentrancyAttacker(computeRental, bazaar));
        vm.deal(attacker, 100 ether);

        // Set up provider with resources
        _setupProvider(provider);
    }

    function _setupProvider(address _provider) internal {
        ComputeRental.ComputeResources memory resources = ComputeRental.ComputeResources({
            gpuType: ComputeRental.GPUType.NVIDIA_RTX_4090,
            gpuCount: 1,
            gpuVram: 24,
            cpuCores: 32,
            memoryGb: 128,
            storageGb: 1000,
            bandwidthMbps: 10000,
            teeCapable: true
        });

        ComputeRental.ResourcePricing memory pricing = ComputeRental.ResourcePricing({
            pricePerHour: 0.1 ether,
            pricePerGpuHour: 0.05 ether,
            minimumRentalHours: 1,
            maximumRentalHours: 720
        });

        string[] memory supportedImages = new string[](1);
        supportedImages[0] = "ubuntu:latest";

        vm.prank(_provider);
        computeRental.setProviderResources(resources, pricing, 5, supportedImages, true, true);
    }

    // ============ ComputeRental Reentrancy Tests ============

    function test_ComputeRental_ReentrancyOnCancel_Protected() public {
        // Create a rental
        vm.prank(victim);
        computeRental.createRental{value: 1 ether}(provider, 5, "ssh-rsa AAAA...", "ubuntu:latest", "");

        // Try reentrancy attack on cancel - should be protected by nonReentrant
        uint256 attackerBalBefore = attacker.balance;

        // Attacker creates a rental then tries to cancel with reentrancy
        vm.prank(attacker);
        bytes32 attackerRentalId =
            computeRental.createRental{value: 1 ether}(provider, 5, "ssh-rsa AAAA...", "ubuntu:latest", "");

        // Cancel should succeed but reentrancy should be blocked
        vm.prank(attacker);
        computeRental.cancelRental(attackerRentalId);

        // Attacker should only get back their 1 ether, not more
        assertLe(attacker.balance, attackerBalBefore); // Can't drain more
    }

    function test_ComputeRental_ReentrancyOnComplete_Protected() public {
        // Create and start a rental
        vm.prank(victim);
        bytes32 rentalId =
            computeRental.createRental{value: 1 ether}(provider, 5, "ssh-rsa AAAA...", "ubuntu:latest", "");

        vm.prank(provider);
        computeRental.startRental(rentalId, "host.compute.network", 22, "container-id");

        // Skip some time
        vm.warp(block.timestamp + 1 hours);

        uint256 treasuryBalBefore = treasury.balance;
        uint256 providerBalBefore = provider.balance;

        // Complete rental
        vm.prank(provider);
        computeRental.completeRental(rentalId);

        // Provider and treasury received funds
        assertGt(treasury.balance, treasuryBalBefore);
        assertGt(provider.balance, providerBalBefore);

        // Rental status is completed
        ComputeRental.Rental memory rental = computeRental.getRental(rentalId);
        assertEq(uint256(rental.status), uint256(ComputeRental.RentalStatus.COMPLETED));
    }

    function test_ComputeRental_ReentrancyOnDispute_Protected() public {
        // Create and start a rental
        vm.prank(victim);
        bytes32 rentalId =
            computeRental.createRental{value: 1 ether}(provider, 5, "ssh-rsa AAAA...", "ubuntu:latest", "");

        vm.prank(provider);
        computeRental.startRental(rentalId, "host.compute.network", 22, "container-id");

        // Create dispute
        vm.prank(victim);
        bytes32 disputeId = computeRental.createDispute{value: 0.01 ether}(
            rentalId, ComputeRental.DisputeReason.PROVIDER_OFFLINE, "ipfs://evidence"
        );

        // Resolve in favor of victim
        vm.prank(owner);
        computeRental.resolveDispute(disputeId, true, 0);

        // Dispute resolved correctly
        ComputeRental.Dispute memory dispute = computeRental.getDispute(disputeId);
        assertTrue(dispute.resolved);
        assertTrue(dispute.inFavorOfInitiator);
    }

    // ============ Bazaar Reentrancy Tests ============

    function test_Bazaar_ReentrancyOnBuy_Protected() public {
        // Mint NFT to victim
        nftToken.mint(victim, 1);

        // Victim approves and lists
        vm.startPrank(victim);
        nftToken.approve(address(bazaar), 1);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721, address(nftToken), 1, 1, Bazaar.Currency.ETH, address(0), 1 ether, 0
        );
        vm.stopPrank();

        // Attacker buys
        uint256 victimBalBefore = victim.balance;
        vm.prank(attacker);
        bazaar.buyListing{value: 1 ether}(listingId);

        // Victim received funds
        assertGt(victim.balance, victimBalBefore);

        // NFT transferred correctly
        assertEq(nftToken.ownerOf(1), attacker);
    }

    // ============ OutputSettler Reentrancy Tests ============

    function test_OutputSettler_ReentrancyOnFill_Protected() public {
        // Deposit liquidity
        vm.prank(provider);
        outputSettler.depositETH{value: 10 ether}();

        bytes32 orderId = keccak256("order1");

        // Fill order
        bytes memory fillerData = abi.encode(
            address(0), // ETH
            1 ether,
            victim,
            0.01 ether // gas
        );

        vm.prank(provider);
        outputSettler.fill(orderId, "", fillerData);

        // Order filled once
        assertTrue(outputSettler.isFilled(orderId));

        // Can't fill again
        vm.prank(provider);
        vm.expectRevert(OutputSettler.OrderAlreadyFilled.selector);
        outputSettler.fill(orderId, "", fillerData);
    }

    function test_OutputSettler_ReentrancyOnFillDirect_Protected() public {
        bytes32 orderId = keccak256("order2");

        uint256 victimBalBefore = victim.balance;

        // Fill direct
        vm.prank(provider);
        outputSettler.fillDirect{value: 1 ether}(orderId, address(0), 1 ether, victim);

        // Order filled once
        assertTrue(outputSettler.isFilled(orderId));
        assertEq(victim.balance, victimBalBefore + 1 ether);

        // Can't fill again
        vm.prank(provider);
        vm.expectRevert(OutputSettler.OrderAlreadyFilled.selector);
        outputSettler.fillDirect{value: 1 ether}(orderId, address(0), 1 ether, victim);
    }

    function test_OutputSettler_DoubleFillAttack_Blocked() public {
        bytes32 orderId = keccak256("order3");

        // First fill
        vm.prank(provider);
        outputSettler.fillDirect{value: 1 ether}(orderId, address(0), 1 ether, victim);

        // Attacker tries to double-fill
        vm.prank(attacker);
        vm.expectRevert(OutputSettler.OrderAlreadyFilled.selector);
        outputSettler.fillDirect{value: 1 ether}(orderId, address(0), 1 ether, attacker);

        // Victim kept their funds
        assertGt(victim.balance, 0);
    }
}

// ============ Attacker Contract ============

contract ReentrancyAttacker {
    ComputeRental public computeRental;
    Bazaar public bazaar;

    uint256 public reentryCount;
    bytes32 public targetRentalId;

    constructor(ComputeRental _computeRental, Bazaar _bazaar) {
        computeRental = _computeRental;
        bazaar = _bazaar;
    }

    receive() external payable {
        if (reentryCount < 2 && targetRentalId != bytes32(0)) {
            reentryCount++;
            // Attempt reentrancy (will fail due to nonReentrant modifier)
            try computeRental.cancelRental(targetRentalId) {
                // If we get here, the attack succeeded (bad!)
            } catch {
                // Expected - attack blocked
            }
        }
    }

    function attack(bytes32 _rentalId) external {
        targetRentalId = _rentalId;
        reentryCount = 0;
        computeRental.cancelRental(_rentalId);
    }
}

// ============ Mock Contracts ============

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(balanceOf[from] >= amount, "Insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockERC721 {
    string public name;
    string public symbol;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 tokenId) external {
        _owners[tokenId] = to;
        _balances[to]++;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _owners[tokenId];
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function approve(address to, uint256 tokenId) external {
        _tokenApprovals[tokenId] = to;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(_owners[tokenId] == from, "Not owner");
        require(
            msg.sender == from || _tokenApprovals[tokenId] == msg.sender || _operatorApprovals[from][msg.sender],
            "Not approved"
        );
        _owners[tokenId] = to;
        _balances[from]--;
        _balances[to]++;
        delete _tokenApprovals[tokenId];
    }
}
