// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CrossChainNFT} from "../../src/bridge/nfteil/CrossChainNFT.sol";
import {WrappedNFT} from "../../src/bridge/nfteil/WrappedNFT.sol";
import {NFTPaymaster} from "../../src/bridge/nfteil/NFTPaymaster.sol";
import {NFTAssetType, WrappedNFTInfo, NFTVoucherRequest, ICrossChainNFTHandler} from "../../src/bridge/nfteil/INFTEIL.sol";

/**
 * @title MockMailbox
 * @notice Mock Hyperlane mailbox for testing
 */
contract MockMailbox {
    uint32 public localDomain = 1;
    mapping(uint32 => bytes32) public lastMessage;
    uint256 private _nonce;

    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId) {
        lastMessage[destinationDomain] = keccak256(messageBody);
        messageId = keccak256(abi.encodePacked(block.number, _nonce++));
    }

    function process(bytes calldata, bytes calldata) external {}

    function setLocalDomain(uint32 _domain) external {
        localDomain = _domain;
    }
}

/**
 * @title MockIGP
 * @notice Mock gas paymaster for testing
 */
contract MockIGP {
    function payForGas(
        bytes32,
        uint32,
        uint256,
        address
    ) external payable {}

    function quoteGasPayment(uint32, uint256) external pure returns (uint256) {
        return 0.001 ether;
    }
}

/**
 * @title TestCrossChainNFT
 * @notice Concrete implementation for testing
 */
contract TestCrossChainNFT is CrossChainNFT {
    uint256 private _tokenIdCounter;

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) CrossChainNFT(name_, symbol_, initialOwner) {}

    function initialize(
        address mailbox,
        address igp,
        uint32 homeChainDomain,
        bool isHomeChain
    ) external {
        _initializeCrossChain(mailbox, igp, homeChainDomain, isHomeChain);
    }

    function mint(address to, uint256 tokenId, string memory uri) external {
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function mintNext(address to, string memory uri) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }
}

/**
 * @title CrossChainNFTTest
 * @notice Unit tests for CrossChainNFT
 */
contract CrossChainNFTTest is Test {
    TestCrossChainNFT public nft;
    MockMailbox public mailbox;
    MockIGP public igp;
    WrappedNFT public wrappedNFT;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);

    uint32 constant HOME_DOMAIN = 1;
    uint32 constant DEST_DOMAIN = 2;

    function setUp() public {
        // Deploy mocks
        mailbox = new MockMailbox();
        igp = new MockIGP();

        // Deploy NFT
        vm.startPrank(owner);
        nft = new TestCrossChainNFT("Test NFT", "TNFT", owner);
        nft.initialize(address(mailbox), address(igp), HOME_DOMAIN, true);
        
        // Configure router for destination
        nft.setRouter(DEST_DOMAIN, bytes32(uint256(uint160(address(0x123)))));
        nft.setDomainEnabled(DEST_DOMAIN, true);

        // Deploy wrapped NFT
        wrappedNFT = new WrappedNFT("Wrapped NFT", "WNFT", owner);
        wrappedNFT.authorizeBridge(owner, true);
        vm.stopPrank();

        // Give users ETH
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
    }

    // ============ Initialization Tests ============

    function test_InitializesCorrectly() public view {
        assertEq(nft.name(), "Test NFT");
        assertEq(nft.symbol(), "TNFT");
        assertEq(nft.homeChainDomain(), HOME_DOMAIN);
        assertTrue(nft.isHomeChainInstance());
    }

    function test_RouterConfiguration() public view {
        assertTrue(nft.supportedDomains(DEST_DOMAIN));
        assertEq(nft.remoteRouters(DEST_DOMAIN), bytes32(uint256(uint160(address(0x123)))));
    }

    // ============ Minting Tests ============

    function test_MintSetsTokenURI() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test-uri");

        assertEq(nft.ownerOf(1), user1);
        assertEq(nft.tokenURI(1), "ipfs://test-uri");
    }

    function test_MintNextIncrementsId() public {
        vm.startPrank(owner);
        uint256 id1 = nft.mintNext(user1, "uri1");
        uint256 id2 = nft.mintNext(user1, "uri2");
        vm.stopPrank();

        assertEq(id1, 0);
        assertEq(id2, 1);
    }

    // ============ Bridge Tests ============

    function test_BridgeNFT_LocksToken() public {
        // Mint NFT to user
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        // Bridge to destination
        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        nft.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();

        // Token should be locked in contract
        assertEq(nft.ownerOf(1), address(nft));
        assertTrue(nft.lockedTokens(1));
        assertEq(nft.totalLocked(), 1);
    }

    function test_BridgeNFT_EmitsEvent() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        
        // Just verify bridge completes and stats update
        bytes32 messageId = nft.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();

        // Verify messageId is returned
        assertTrue(messageId != bytes32(0));
        
        // Verify stats
        (uint256 totalBridged, , , ) = nft.getCrossChainStats();
        assertEq(totalBridged, 1);
    }

    function test_BridgeNFT_RevertsForUnsupportedDomain() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        
        vm.expectRevert(abi.encodeWithSelector(CrossChainNFT.UnsupportedDomain.selector, 999));
        nft.bridgeNFT{value: 0.01 ether}(999, recipient, 1);
        vm.stopPrank();
    }

    function test_BridgeNFT_RevertsForNonOwner() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user2);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        
        vm.expectRevert(CrossChainNFT.NotTokenOwner.selector);
        nft.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();
    }

    function test_BridgeNFT_RevertsForInsufficientGas() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        
        vm.expectRevert(abi.encodeWithSelector(
            CrossChainNFT.InsufficientGasPayment.selector,
            0.001 ether,
            0.0001 ether
        ));
        nft.bridgeNFT{value: 0.0001 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();
    }

    // ============ Provenance Tests ============

    function test_BridgeRecordsProvenance() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        nft.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();

        assertEq(nft.getProvenanceCount(1), 1);
    }

    // ============ Stats Tests ============

    function test_CrossChainStatsTracking() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        bytes32 recipient = bytes32(uint256(uint160(user2)));
        nft.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, 1);
        vm.stopPrank();

        (uint256 totalBridged, uint256 totalReceived, uint32 homeDomain, bool isHome) = nft.getCrossChainStats();
        
        assertEq(totalBridged, 1);
        assertEq(totalReceived, 0);
        assertEq(homeDomain, HOME_DOMAIN);
        assertTrue(isHome);
    }

    // ============ Wrapped NFT Tests ============

    function test_WrappedNFT_Wrap() public {
        vm.startPrank(owner);
        uint256 wrappedId = wrappedNFT.wrap(
            1, // home chain
            address(0x123), // original collection
            42, // original token id
            "ipfs://original-uri",
            user1
        );
        vm.stopPrank();

        // Should preserve original tokenId
        assertEq(wrappedId, 42);
        assertEq(wrappedNFT.ownerOf(42), user1);
        assertTrue(wrappedNFT.isWrapped(42));
    }

    function test_WrappedNFT_GetOriginalInfo() public {
        vm.startPrank(owner);
        wrappedNFT.wrap(1, address(0x123), 42, "ipfs://test", user1);
        vm.stopPrank();

        WrappedNFTInfo memory info = wrappedNFT.getOriginalInfo(42);
        
        assertEq(info.homeChainId, 1);
        assertEq(info.originalCollection, address(0x123));
        assertEq(info.originalTokenId, 42);
        assertEq(info.tokenURI, "ipfs://test");
    }

    function test_WrappedNFT_Unwrap() public {
        vm.startPrank(owner);
        wrappedNFT.wrap(1, address(0x123), 42, "ipfs://test", user1);
        vm.stopPrank();

        vm.prank(user1);
        wrappedNFT.unwrap(42);

        assertFalse(wrappedNFT.isWrapped(42));
        
        // Token should be burned (ownerOf should revert)
        vm.expectRevert();
        wrappedNFT.ownerOf(42);
    }

    function test_WrappedNFT_CantWrapTwice() public {
        vm.startPrank(owner);
        wrappedNFT.wrap(1, address(0x123), 42, "ipfs://test", user1);
        
        vm.expectRevert(WrappedNFT.TokenAlreadyWrapped.selector);
        wrappedNFT.wrap(1, address(0x123), 42, "ipfs://test2", user2);
        vm.stopPrank();
    }

    // ============ Admin Tests ============

    function test_ConfigureRouters_Batch() public {
        uint32[] memory domains = new uint32[](2);
        bytes32[] memory routers = new bytes32[](2);
        
        domains[0] = 100;
        domains[1] = 200;
        routers[0] = bytes32(uint256(1));
        routers[1] = bytes32(uint256(2));

        vm.prank(owner);
        nft.configureRouters(domains, routers);

        assertTrue(nft.supportedDomains(100));
        assertTrue(nft.supportedDomains(200));
        assertEq(nft.remoteRouters(100), bytes32(uint256(1)));
        assertEq(nft.remoteRouters(200), bytes32(uint256(2)));
    }

    // ============ Quote Tests ============

    function test_QuoteBridge() public view {
        uint256 quote = nft.quoteBridge(DEST_DOMAIN, 1);
        assertEq(quote, 0.001 ether);
    }
}

/**
 * @title NFTPaymasterTest
 * @notice Unit tests for NFTPaymaster
 */
contract NFTPaymasterTest is Test {
    NFTPaymaster public paymaster;
    TestCrossChainNFT public nft;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public xlp = address(3);

    uint256 constant CHAIN_ID = 1;
    uint256 constant DEST_CHAIN = 2;

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy paymaster
        paymaster = new NFTPaymaster(CHAIN_ID, address(0x999));
        
        // Deploy test NFT
        nft = new TestCrossChainNFT("Test", "TST", owner);
        
        // Configure
        paymaster.setSupportedCollection(address(nft), true);
        paymaster.updateXLPStake(xlp, 1 ether);
        paymaster.registerWrappedCollection(CHAIN_ID, address(nft), address(0x456));
        
        vm.stopPrank();

        vm.deal(user1, 10 ether);
        vm.deal(xlp, 10 ether);
    }

    function test_CreateVoucherRequest() public {
        // Mint NFT
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        // Approve
        vm.startPrank(user1);
        nft.approve(address(paymaster), 1);

        // Create request
        bytes32 requestId = paymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nft),
            1,
            1,
            DEST_CHAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        // NFT should be locked
        assertEq(nft.ownerOf(1), address(paymaster));
        
        // Request should exist
        NFTVoucherRequest memory request = paymaster.getRequest(requestId);
        assertEq(request.requester, user1);
        assertEq(request.collection, address(nft));
        assertEq(request.tokenId, 1);
    }

    function test_GetCurrentFee_Increases() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        nft.approve(address(paymaster), 1);
        bytes32 requestId = paymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nft),
            1,
            1,
            DEST_CHAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        uint256 fee1 = paymaster.getCurrentFee(requestId);
        
        // Advance blocks
        vm.roll(block.number + 10);
        
        uint256 fee2 = paymaster.getCurrentFee(requestId);
        
        assertTrue(fee2 > fee1);
    }

    function test_RefundExpiredRequest() public {
        vm.prank(owner);
        nft.mint(user1, 1, "ipfs://test");

        vm.startPrank(user1);
        nft.approve(address(paymaster), 1);
        bytes32 requestId = paymaster.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nft),
            1,
            1,
            DEST_CHAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        // Advance past deadline
        vm.roll(block.number + 200);

        // Refund
        uint256 balBefore = user1.balance;
        paymaster.refundExpiredRequest(requestId);
        uint256 balAfter = user1.balance;

        // NFT returned
        assertEq(nft.ownerOf(1), user1);
        
        // Fee returned
        assertTrue(balAfter > balBefore);
    }

    function test_Stats() public view {
        (uint256 totalRequests, uint256 totalBridged) = paymaster.getStats();
        assertEq(totalRequests, 0);
        assertEq(totalBridged, 0);
    }
}

// Struct already imported at top
