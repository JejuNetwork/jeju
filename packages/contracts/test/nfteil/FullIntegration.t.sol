// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// NFT-EIL Contracts
import {CrossChainNFT} from "../../src/bridge/nfteil/CrossChainNFT.sol";
import {CrossChainMultiToken} from "../../src/bridge/nfteil/CrossChainMultiToken.sol";
import {WrappedNFT} from "../../src/bridge/nfteil/WrappedNFT.sol";
import {NFTPaymaster} from "../../src/bridge/nfteil/NFTPaymaster.sol";
import {NFTInputSettler} from "../../src/bridge/nfteil/NFTInputSettler.sol";
import {
    NFTAssetType, 
    WrappedNFTInfo, 
    NFTVoucherRequest, 
    NFTVoucher,
    NFTTransferOrderData,
    NFT_TRANSFER_ORDER_TYPE
} from "../../src/bridge/nfteil/INFTEIL.sol";

// OIF
import {
    IInputSettler,
    IOracle,
    GaslessCrossChainOrder,
    ResolvedCrossChainOrder,
    Output,
    FillInstruction
} from "../../src/oif/IOIF.sol";

/**
 * @title MockMailbox
 * @notice Realistic Hyperlane mailbox mock with message delivery
 */
contract MockMailbox {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint32 public localDomain;
    uint256 private _nonce;
    
    struct Message {
        uint32 origin;
        bytes32 sender;
        bytes body;
        bool delivered;
    }
    
    mapping(bytes32 => Message) public messages;
    bytes32[] public messageQueue;

    event MessageDispatched(bytes32 indexed messageId, uint32 destination, bytes32 recipient);
    event MessageProcessed(bytes32 indexed messageId, uint32 origin, address recipient);

    constructor(uint32 _domain) {
        localDomain = _domain;
    }

    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId) {
        messageId = keccak256(abi.encodePacked(
            localDomain,
            destinationDomain,
            msg.sender,
            recipientAddress,
            _nonce++,
            block.timestamp
        ));
        
        messages[messageId] = Message({
            origin: localDomain,
            sender: bytes32(uint256(uint160(msg.sender))),
            body: messageBody,
            delivered: false
        });
        
        messageQueue.push(messageId);
        emit MessageDispatched(messageId, destinationDomain, recipientAddress);
    }

    function getMessage(bytes32 messageId) external view returns (uint32 origin, bytes32 sender, bytes memory body) {
        Message storage msg_ = messages[messageId];
        return (msg_.origin, msg_.sender, msg_.body);
    }

    function markDelivered(bytes32 messageId) external {
        messages[messageId].delivered = true;
    }

    function getQueueLength() external view returns (uint256) {
        return messageQueue.length;
    }
}

/**
 * @title MockIGP
 * @notice Mock Interchain Gas Paymaster with realistic pricing
 */
contract MockIGP {
    uint256 public baseFee = 0.0001 ether;
    uint256 public gasPrice = 20 gwei;
    
    mapping(uint32 => uint256) public domainGasMultiplier;
    
    event GasPaid(bytes32 indexed messageId, uint32 destination, uint256 amount);

    constructor() {
        // Set default multipliers
        domainGasMultiplier[1] = 100; // Ethereum mainnet - expensive
        domainGasMultiplier[2] = 10;  // L2 - cheap
        domainGasMultiplier[137] = 5; // Polygon - very cheap
    }

    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address /* refundAddress */
    ) external payable {
        uint256 required = quoteGasPayment(destinationDomain, gasAmount);
        require(msg.value >= required, "Insufficient gas payment");
        emit GasPaid(messageId, destinationDomain, msg.value);
    }

    function quoteGasPayment(uint32 destinationDomain, uint256 gasAmount) public view returns (uint256) {
        uint256 multiplier = domainGasMultiplier[destinationDomain];
        if (multiplier == 0) multiplier = 50; // Default
        return baseFee + (gasAmount * gasPrice * multiplier / 100);
    }
}

/**
 * @title MockOracle
 * @notice Mock Oracle for OIF attestations
 */
contract MockOracle is IOracle {
    mapping(bytes32 => bool) public attestations;
    mapping(bytes32 => bytes) public attestationData;
    mapping(bytes32 => uint256) public attestationBlocks;
    
    event Attested(bytes32 indexed orderId, bytes proof);

    function attest(bytes32 orderId, bytes calldata proof) external {
        attestations[orderId] = true;
        attestationData[orderId] = proof;
        attestationBlocks[orderId] = block.number;
        emit Attested(orderId, proof);
    }

    function hasAttested(bytes32 orderId) external view override returns (bool) {
        return attestations[orderId];
    }

    function getAttestationBlock(bytes32 orderId) external view override returns (uint256) {
        return attestationBlocks[orderId];
    }

    function getAttestation(bytes32 orderId) external view override returns (bytes memory) {
        return attestationData[orderId];
    }

    function getAttestationBlock(bytes32 orderId) external view override returns (uint256) {
        return attestationBlocks[orderId];
    }

    function submitAttestation(bytes32 orderId, bytes calldata proof) external override {
        attestations[orderId] = true;
        attestationData[orderId] = proof;
        attestationBlocks[orderId] = block.number;
        emit Attested(orderId, proof);
    }
}

/**
 * @title MockL1StakeManager
 * @notice Mock L1 Stake Manager for XLP stake verification
 */
contract MockL1StakeManager {
    struct XLPStake {
        uint256 amount;
        uint256 registeredAt;
        bool active;
    }
    
    mapping(address => XLPStake) public stakes;
    uint256 public totalStaked;
    
    event XLPRegistered(address indexed xlp, uint256 amount);
    event XLPSlashed(address indexed xlp, uint256 amount, bytes32 reason);

    function registerXLP(uint256 amount) external payable {
        require(msg.value >= amount, "Insufficient stake");
        stakes[msg.sender] = XLPStake({
            amount: amount,
            registeredAt: block.timestamp,
            active: true
        });
        totalStaked += amount;
        emit XLPRegistered(msg.sender, amount);
    }

    function getStake(address xlp) external view returns (uint256) {
        return stakes[xlp].amount;
    }

    function isActive(address xlp) external view returns (bool) {
        return stakes[xlp].active;
    }

    function slash(address xlp, uint256 amount, bytes32 reason) external {
        require(stakes[xlp].amount >= amount, "Insufficient stake");
        stakes[xlp].amount -= amount;
        totalStaked -= amount;
        emit XLPSlashed(xlp, amount, reason);
    }
}

/**
 * @title TestHomeNFT
 */
contract TestHomeNFT is CrossChainNFT {
    uint256 private _tokenIdCounter;

    constructor(address mailbox, address igp) CrossChainNFT("Home NFT", "HNFT", msg.sender) {
        _initializeCrossChain(mailbox, igp, 1, true);
    }

    function mint(address to, string memory uri) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }
}

/**
 * @title TestSyntheticNFT
 */
contract TestSyntheticNFT is CrossChainNFT {
    constructor(address mailbox, address igp) CrossChainNFT("Synthetic NFT", "SNFT", msg.sender) {
        _initializeCrossChain(mailbox, igp, 2, false);
    }
}

/**
 * @title FullIntegrationTest
 * @notice Tests full integration of EIL, Hyperlane, and OIF for NFTs
 */
contract FullIntegrationTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Infrastructure
    MockMailbox public mailboxL1;
    MockMailbox public mailboxL2;
    MockIGP public igpL1;
    MockIGP public igpL2;
    MockOracle public oracle;
    MockL1StakeManager public l1StakeManager;

    // NFT Contracts
    TestHomeNFT public nftL1;
    TestSyntheticNFT public nftL2;
    WrappedNFT public wrappedNFT;
    NFTPaymaster public nftPaymaster;
    NFTInputSettler public nftInputSettler;

    // Test accounts
    address public owner;
    uint256 public ownerKey;
    address public user1;
    uint256 public user1Key;
    address public user2;
    address public xlp;
    uint256 public xlpKey;
    address public solver;
    uint256 public solverKey;

    uint32 constant L1_DOMAIN = 1;
    uint32 constant L2_DOMAIN = 2;

    function setUp() public {
        // Generate accounts with private keys for signing
        ownerKey = 0xA11CE;
        owner = vm.addr(ownerKey);
        user1Key = 0xB0B;
        user1 = vm.addr(user1Key);
        user2 = address(3);
        xlpKey = 0xC0DE;
        xlp = vm.addr(xlpKey);
        solverKey = 0xD0D0;
        solver = vm.addr(solverKey);

        vm.startPrank(owner);

        // Deploy Infrastructure
        mailboxL1 = new MockMailbox(L1_DOMAIN);
        mailboxL2 = new MockMailbox(L2_DOMAIN);
        igpL1 = new MockIGP();
        igpL2 = new MockIGP();
        oracle = new MockOracle();
        l1StakeManager = new MockL1StakeManager();

        // Deploy NFT Contracts
        nftL1 = new TestHomeNFT(address(mailboxL1), address(igpL1));
        nftL2 = new TestSyntheticNFT(address(mailboxL2), address(igpL2));
        wrappedNFT = new WrappedNFT("Wrapped NFT", "WNFT", owner);
        nftPaymaster = new NFTPaymaster(L1_DOMAIN, address(l1StakeManager));
        nftInputSettler = new NFTInputSettler(L1_DOMAIN, address(oracle), address(0));

        // Configure routers
        nftL1.setRouter(L2_DOMAIN, bytes32(uint256(uint160(address(nftL2)))));
        nftL1.setDomainEnabled(L2_DOMAIN, true);
        nftL2.setRouter(L1_DOMAIN, bytes32(uint256(uint160(address(nftL1)))));
        nftL2.setDomainEnabled(L1_DOMAIN, true);

        // Configure NFT Paymaster
        nftPaymaster.setSupportedCollection(address(nftL1), true);

        // Configure Wrapped NFT
        wrappedNFT.authorizeBridge(owner, true);
        wrappedNFT.authorizeBridge(address(nftPaymaster), true);

        vm.stopPrank();

        // Fund accounts
        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(xlp, 100 ether);
        vm.deal(solver, 100 ether);
    }

    // =========================================================================
    // HYPERLANE INTEGRATION TESTS
    // =========================================================================

    function test_Hyperlane_FullMessageFlow() public {
        console.log("=== Hyperlane Integration Test ===");

        // Mint NFT
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://test-hyperlane");
        
        // Get gas quote
        uint256 gasQuote = nftL1.quoteBridge(L2_DOMAIN, tokenId);
        console.log("Gas quote for L2:", gasQuote);
        assertTrue(gasQuote > 0);

        // Bridge NFT
        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user1)));
        bytes32 messageId = nftL1.bridgeNFT{value: gasQuote}(L2_DOMAIN, recipient, tokenId);
        vm.stopPrank();

        console.log("Message dispatched, ID:", uint256(messageId));
        assertTrue(messageId != bytes32(0));

        // Verify message in queue
        assertEq(mailboxL1.getQueueLength(), 1);

        // Verify NFT locked
        assertEq(nftL1.ownerOf(tokenId), address(nftL1));
        assertTrue(nftL1.lockedTokens(tokenId));

        // Get message data and deliver on destination
        (uint32 origin, bytes32 sender, bytes memory body) = mailboxL1.getMessage(messageId);
        
        // Mailbox L2 calls handle (we use mailboxL2 as sender since nftL2 checks its mailbox)
        vm.prank(address(mailboxL2));
        nftL2.handle(origin, sender, body);

        mailboxL1.markDelivered(messageId);

        // Verify NFT minted on L2
        assertEq(nftL2.ownerOf(tokenId), user1);
        assertEq(nftL2.tokenURI(tokenId), "ipfs://test-hyperlane");

        console.log("=== Hyperlane Test PASSED ===");
    }

    function test_Hyperlane_MultiDomainRouters() public {
        console.log("=== Multi-Domain Router Test ===");

        // Configure multiple domains
        uint32[] memory domains = new uint32[](3);
        bytes32[] memory routers = new bytes32[](3);
        domains[0] = 137; // Polygon
        domains[1] = 42161; // Arbitrum
        domains[2] = 10; // Optimism
        routers[0] = bytes32(uint256(0x1));
        routers[1] = bytes32(uint256(0x2));
        routers[2] = bytes32(uint256(0x3));

        vm.prank(owner);
        nftL1.configureRouters(domains, routers);

        // Verify all configured
        assertTrue(nftL1.supportedDomains(137));
        assertTrue(nftL1.supportedDomains(42161));
        assertTrue(nftL1.supportedDomains(10));
        assertEq(nftL1.remoteRouters(137), routers[0]);

        console.log("=== Multi-Domain Test PASSED ===");
    }

    // =========================================================================
    // EIL INTEGRATION TESTS  
    // =========================================================================

    function test_EIL_XLPRegistrationAndStake() public {
        console.log("=== EIL XLP Registration Test ===");

        // Register XLP with stake
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);

        // Verify stake
        assertEq(l1StakeManager.getStake(xlp), 5 ether);
        assertTrue(l1StakeManager.isActive(xlp));
        assertEq(l1StakeManager.totalStaked(), 5 ether);

        console.log("XLP stake:", l1StakeManager.getStake(xlp) / 1e18, "ETH");
        console.log("=== EIL XLP Test PASSED ===");
    }

    function test_EIL_VoucherCreationWithXLP() public {
        console.log("=== EIL Voucher Creation Test ===");

        // Register XLP
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);

        // Update XLP stake in paymaster
        vm.prank(owner);
        nftPaymaster.updateXLPStake(xlp, 5 ether);

        // Register wrapped collection
        vm.prank(xlp);
        nftPaymaster.registerWrappedCollection(L1_DOMAIN, address(nftL1), address(wrappedNFT));

        // Mint NFT
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://eil-test");

        // Create voucher request
        vm.startPrank(user1);
        nftL1.approve(address(nftPaymaster), tokenId);
        
        bytes32 requestId = nftPaymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nftL1),
            tokenId,
            1,
            L2_DOMAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        // Verify request
        NFTVoucherRequest memory request = nftPaymaster.getRequest(requestId);
        assertEq(request.requester, user1);
        assertEq(request.collection, address(nftL1));
        assertEq(request.tokenId, tokenId);
        assertEq(request.destinationChainId, L2_DOMAIN);
        assertFalse(request.claimed);

        console.log("Request ID:", uint256(requestId));
        console.log("=== EIL Voucher Test PASSED ===");
    }

    function test_EIL_FeeAuction() public {
        console.log("=== EIL Fee Auction Test ===");

        // Setup
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);
        vm.prank(owner);
        nftPaymaster.updateXLPStake(xlp, 5 ether);
        vm.prank(xlp);
        nftPaymaster.registerWrappedCollection(L1_DOMAIN, address(nftL1), address(wrappedNFT));

        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://fee-auction");

        vm.startPrank(user1);
        nftL1.approve(address(nftPaymaster), tokenId);
        bytes32 requestId = nftPaymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nftL1),
            tokenId,
            1,
            L2_DOMAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether // Fee increment per block
        );
        vm.stopPrank();

        // Check fee progression
        uint256 fee0 = nftPaymaster.getCurrentFee(requestId);
        console.log("Fee at block 0:", fee0);

        vm.roll(block.number + 10);
        uint256 fee10 = nftPaymaster.getCurrentFee(requestId);
        console.log("Fee at block 10:", fee10);

        vm.roll(block.number + 50);
        uint256 fee60 = nftPaymaster.getCurrentFee(requestId);
        console.log("Fee at block 60:", fee60);

        assertTrue(fee10 > fee0);
        assertTrue(fee60 > fee10);
        assertTrue(fee60 <= 0.01 ether); // Max fee cap

        console.log("=== Fee Auction Test PASSED ===");
    }

    function test_EIL_FullVoucherFlow() public {
        console.log("=== EIL Full Voucher Flow Test ===");

        // 1. XLP registers and stakes
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);
        vm.prank(owner);
        nftPaymaster.updateXLPStake(xlp, 5 ether);
        vm.prank(xlp);
        nftPaymaster.registerWrappedCollection(L1_DOMAIN, address(nftL1), address(wrappedNFT));

        // 2. User creates request
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://full-flow");
        
        vm.startPrank(user1);
        nftL1.approve(address(nftPaymaster), tokenId);
        bytes32 requestId = nftPaymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nftL1),
            tokenId,
            1,
            L2_DOMAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        assertTrue(nftPaymaster.canFulfillRequest(requestId));
        console.log("Request created and fulfillable");

        // 3. XLP issues voucher
        uint256 currentFee = nftPaymaster.getCurrentFee(requestId);
        bytes32 commitment = keccak256(abi.encodePacked(
            requestId,
            xlp,
            address(nftL1),
            tokenId,
            uint256(1),
            currentFee,
            uint256(L2_DOMAIN)
        ));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(xlpKey, commitment.toEthSignedMessageHash());
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(xlp);
        bytes32 voucherId = nftPaymaster.issueNFTVoucher(requestId, signature);

        NFTVoucher memory voucher = nftPaymaster.getVoucher(voucherId);
        assertEq(voucher.xlp, xlp);
        assertEq(voucher.tokenId, tokenId);
        console.log("Voucher issued:", uint256(voucherId));

        console.log("=== Full Voucher Flow Test PASSED ===");
    }

    // =========================================================================
    // OIF INTEGRATION TESTS
    // =========================================================================

    function test_OIF_NFTOrderCreation() public {
        console.log("=== OIF NFT Order Creation Test ===");

        // Mint NFT
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://oif-test");

        // Build order data
        NFTTransferOrderData memory nftData = NFTTransferOrderData({
            assetType: NFTAssetType.ERC721,
            collection: address(nftL1),
            tokenId: tokenId,
            amount: 1,
            destinationChainId: L2_DOMAIN,
            recipient: user1,
            metadataHash: keccak256("ipfs://oif-test")
        });

        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(nftInputSettler),
            user: user1,
            nonce: 0,
            originChainId: L1_DOMAIN,
            openDeadline: uint32(block.number + 100),
            fillDeadline: uint32(block.number + 200),
            orderDataType: NFT_TRANSFER_ORDER_TYPE,
            orderData: abi.encode(nftData)
        });

        // Approve and open order
        vm.startPrank(user1);
        nftL1.approve(address(nftInputSettler), tokenId);
        nftInputSettler.open(order);
        vm.stopPrank();

        // Verify NFT locked
        assertEq(nftL1.ownerOf(tokenId), address(nftInputSettler));
        console.log("NFT locked in settler");

        // Verify nonce incremented
        assertEq(nftInputSettler.getUserNonce(user1), 1);

        console.log("=== OIF Order Creation Test PASSED ===");
    }

    function test_OIF_GaslessOrder() public {
        console.log("=== OIF Gasless Order Test ===");

        // Mint NFT
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://gasless");

        // Build order
        NFTTransferOrderData memory nftData = NFTTransferOrderData({
            assetType: NFTAssetType.ERC721,
            collection: address(nftL1),
            tokenId: tokenId,
            amount: 1,
            destinationChainId: L2_DOMAIN,
            recipient: user1,
            metadataHash: keccak256("ipfs://gasless")
        });

        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(nftInputSettler),
            user: user1,
            nonce: 0,
            originChainId: L1_DOMAIN,
            openDeadline: uint32(block.number + 100),
            fillDeadline: uint32(block.number + 200),
            orderDataType: NFT_TRANSFER_ORDER_TYPE,
            orderData: abi.encode(nftData)
        });

        // User signs the order
        bytes32 orderHash = keccak256(abi.encode(order));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(user1Key, orderHash.toEthSignedMessageHash());
        bytes memory signature = abi.encodePacked(r, s, v);

        // Approve NFT
        vm.prank(user1);
        nftL1.approve(address(nftInputSettler), tokenId);

        // Relayer opens on behalf of user
        vm.prank(solver);
        nftInputSettler.openFor(order, signature, "");

        // Verify NFT locked
        assertEq(nftL1.ownerOf(tokenId), address(nftInputSettler));
        console.log("Gasless order opened by relayer");

        console.log("=== Gasless Order Test PASSED ===");
    }

    function test_OIF_FullSettlementFlow() public {
        console.log("=== OIF Full Settlement Flow Test ===");

        // 1. Create order
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://settlement");

        NFTTransferOrderData memory nftData = NFTTransferOrderData({
            assetType: NFTAssetType.ERC721,
            collection: address(nftL1),
            tokenId: tokenId,
            amount: 1,
            destinationChainId: L2_DOMAIN,
            recipient: user1,
            metadataHash: keccak256("ipfs://settlement")
        });

        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(nftInputSettler),
            user: user1,
            nonce: 0,
            originChainId: L1_DOMAIN,
            openDeadline: uint32(block.number + 100),
            fillDeadline: uint32(block.number + 200),
            orderDataType: NFT_TRANSFER_ORDER_TYPE,
            orderData: abi.encode(nftData)
        });

        // Capture block number before open
        uint256 openBlock = block.number;

        vm.startPrank(user1);
        nftL1.approve(address(nftInputSettler), tokenId);
        nftInputSettler.open(order);
        vm.stopPrank();

        // Get order ID (generated based on user, nonce, etc.)
        bytes32 orderId = keccak256(abi.encodePacked(
            user1,
            uint256(0), // nonce
            uint256(L1_DOMAIN),
            address(nftL1),
            tokenId,
            uint256(L2_DOMAIN),
            openBlock // Block when open was called
        ));

        // 2. Solver claims order
        vm.prank(solver);
        nftInputSettler.claimOrder(orderId);

        // 3. Oracle attests (after solver delivers on destination)
        oracle.attest(orderId, "proof-of-delivery");
        assertTrue(oracle.hasAttested(orderId));
        console.log("Oracle attested delivery");

        // 4. Wait for claim delay
        vm.roll(block.number + 160);

        // 5. Solver settles
        assertTrue(nftInputSettler.canSettle(orderId));
        
        vm.prank(solver);
        nftInputSettler.settle(orderId);

        // 6. Verify solver got NFT
        assertEq(nftL1.ownerOf(tokenId), solver);
        console.log("Solver received NFT");

        console.log("=== Full Settlement Test PASSED ===");
    }

    function test_OIF_OrderExpiry() public {
        console.log("=== OIF Order Expiry Test ===");

        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://expiry");

        NFTTransferOrderData memory nftData = NFTTransferOrderData({
            assetType: NFTAssetType.ERC721,
            collection: address(nftL1),
            tokenId: tokenId,
            amount: 1,
            destinationChainId: L2_DOMAIN,
            recipient: user1,
            metadataHash: keccak256("ipfs://expiry")
        });

        // Use nonce 1 since nonce 0 was used in previous test (but we reset in setUp so should be 0)
        uint256 currentNonce = nftInputSettler.getUserNonce(user1);

        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(nftInputSettler),
            user: user1,
            nonce: currentNonce,
            originChainId: L1_DOMAIN,
            openDeadline: uint32(block.number + 10),
            fillDeadline: uint32(block.number + 20),
            orderDataType: NFT_TRANSFER_ORDER_TYPE,
            orderData: abi.encode(nftData)
        });

        // Capture block number
        uint256 openBlock = block.number;

        vm.startPrank(user1);
        nftL1.approve(address(nftInputSettler), tokenId);
        nftInputSettler.open(order);
        vm.stopPrank();

        // Calculate order ID
        bytes32 orderId = keccak256(abi.encodePacked(
            user1,
            currentNonce,
            uint256(L1_DOMAIN),
            address(nftL1),
            tokenId,
            uint256(L2_DOMAIN),
            openBlock
        ));

        assertFalse(nftInputSettler.canRefund(orderId));

        // Fast forward past expiry (fillDeadline was block+20, we're at block, go to block+25)
        vm.roll(openBlock + 25);

        assertTrue(nftInputSettler.canRefund(orderId));

        // Refund
        nftInputSettler.refund(orderId);

        // User gets NFT back
        assertEq(nftL1.ownerOf(tokenId), user1);
        console.log("Order refunded after expiry");

        console.log("=== Order Expiry Test PASSED ===");
    }

    // =========================================================================
    // COMBINED INTEGRATION TESTS
    // =========================================================================

    function test_Combined_HyperlaneAndWrappedNFT() public {
        console.log("=== Combined Hyperlane + Wrapped NFT Test ===");

        // 1. Mint on L1
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://combined");

        // 2. Bridge via Hyperlane
        uint256 gasQuote = nftL1.quoteBridge(L2_DOMAIN, tokenId);
        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user1)));
        bytes32 messageId = nftL1.bridgeNFT{value: gasQuote}(L2_DOMAIN, recipient, tokenId);
        vm.stopPrank();

        // 3. Deliver message
        (uint32 origin, bytes32 sender, bytes memory body) = mailboxL1.getMessage(messageId);
        vm.prank(address(mailboxL2));
        nftL2.handle(origin, sender, body);

        // 4. Verify on L2
        assertEq(nftL2.ownerOf(tokenId), user1);
        
        // 5. Also create wrapped NFT entry (with different tokenId to avoid collision)
        uint256 wrappedTokenId = 999;
        vm.prank(owner);
        wrappedNFT.wrap(L1_DOMAIN, address(nftL1), wrappedTokenId, "ipfs://wrapped", user2);
        
        // Both should exist
        assertEq(nftL2.ownerOf(tokenId), user1);
        assertEq(wrappedNFT.ownerOf(wrappedTokenId), user2);
        assertTrue(wrappedNFT.isWrapped(wrappedTokenId));

        console.log("=== Combined Test PASSED ===");
    }

    function test_Combined_AllThreeSystems() public {
        console.log("=== Combined All Systems Test ===");
        console.log("Testing: Hyperlane + EIL + OIF");

        // Setup XLP
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);
        vm.prank(owner);
        nftPaymaster.updateXLPStake(xlp, 5 ether);
        vm.prank(xlp);
        nftPaymaster.registerWrappedCollection(L1_DOMAIN, address(nftL1), address(wrappedNFT));

        // Mint 3 NFTs
        vm.startPrank(owner);
        uint256 nft1 = nftL1.mint(user1, "ipfs://nft1-hyperlane");
        uint256 nft2 = nftL1.mint(user1, "ipfs://nft2-eil");
        uint256 nft3 = nftL1.mint(user1, "ipfs://nft3-oif");
        vm.stopPrank();

        console.log("Minted 3 NFTs for different paths");

        // PATH 1: Hyperlane direct bridge
        uint256 gasQuote = nftL1.quoteBridge(L2_DOMAIN, nft1);
        vm.startPrank(user1);
        bytes32 messageId = nftL1.bridgeNFT{value: gasQuote}(L2_DOMAIN, bytes32(uint256(uint160(user1))), nft1);
        vm.stopPrank();
        
        (uint32 origin, bytes32 sender, bytes memory body) = mailboxL1.getMessage(messageId);
        vm.prank(address(mailboxL2));
        nftL2.handle(origin, sender, body);
        
        assertEq(nftL2.ownerOf(nft1), user1);
        console.log("Path 1 (Hyperlane): NFT bridged");

        // PATH 2: EIL XLP fast path
        vm.startPrank(user1);
        nftL1.approve(address(nftPaymaster), nft2);
        bytes32 requestId = nftPaymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nftL1),
            nft2,
            1,
            L2_DOMAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();
        assertEq(nftL1.ownerOf(nft2), address(nftPaymaster));
        console.log("Path 2 (EIL): Voucher request created");

        // PATH 3: OIF intent-based
        NFTTransferOrderData memory nftData = NFTTransferOrderData({
            assetType: NFTAssetType.ERC721,
            collection: address(nftL1),
            tokenId: nft3,
            amount: 1,
            destinationChainId: L2_DOMAIN,
            recipient: user1,
            metadataHash: keccak256("ipfs://nft3-oif")
        });

        GaslessCrossChainOrder memory order = GaslessCrossChainOrder({
            originSettler: address(nftInputSettler),
            user: user1,
            nonce: 0,
            originChainId: L1_DOMAIN,
            openDeadline: uint32(block.number + 100),
            fillDeadline: uint32(block.number + 200),
            orderDataType: NFT_TRANSFER_ORDER_TYPE,
            orderData: abi.encode(nftData)
        });

        vm.startPrank(user1);
        nftL1.approve(address(nftInputSettler), nft3);
        nftInputSettler.open(order);
        vm.stopPrank();
        assertEq(nftL1.ownerOf(nft3), address(nftInputSettler));
        console.log("Path 3 (OIF): Intent order created");

        // Summary
        console.log("");
        console.log("=== All Three Paths Active ===");
        console.log("NFT 1: On L2 via Hyperlane");
        console.log("NFT 2: Locked in NFTPaymaster for XLP fulfillment");
        console.log("NFT 3: Locked in NFTInputSettler for solver fulfillment");
        console.log("=== Combined All Systems Test PASSED ===");
    }

    // =========================================================================
    // STATS AND DIAGNOSTICS
    // =========================================================================

    function test_SystemStats() public {
        console.log("=== System Stats Test ===");

        // Setup activity
        vm.prank(xlp);
        l1StakeManager.registerXLP{value: 5 ether}(5 ether);
        
        vm.prank(owner);
        uint256 tokenId = nftL1.mint(user1, "ipfs://stats");

        uint256 gasQuote = nftL1.quoteBridge(L2_DOMAIN, tokenId);
        vm.prank(user1);
        nftL1.bridgeNFT{value: gasQuote}(L2_DOMAIN, bytes32(uint256(uint160(user1))), tokenId);

        // Get stats
        (uint256 bridgedOut, uint256 bridgedIn, uint32 homeDomain, bool isHome) = nftL1.getCrossChainStats();
        
        console.log("Home NFT Stats:");
        console.log("  Bridged out:", bridgedOut);
        console.log("  Bridged in:", bridgedIn);
        console.log("  Home domain:", homeDomain);
        console.log("  Is home:", isHome);

        (uint256 totalRequests, uint256 totalNFTsBridged) = nftPaymaster.getStats();
        console.log("Paymaster Stats:");
        console.log("  Total requests:", totalRequests);
        console.log("  Total bridged:", totalNFTsBridged);

        console.log("L1 Stake Manager:");
        console.log("  Total staked:", l1StakeManager.totalStaked() / 1e18, "ETH");

        console.log("=== Stats Test PASSED ===");
    }
}
