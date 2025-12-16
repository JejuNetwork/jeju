// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {CrossChainNFT} from "../../src/bridge/nfteil/CrossChainNFT.sol";
import {CrossChainMultiToken} from "../../src/bridge/nfteil/CrossChainMultiToken.sol";
import {WrappedNFT} from "../../src/bridge/nfteil/WrappedNFT.sol";
import {NFTPaymaster} from "../../src/bridge/nfteil/NFTPaymaster.sol";
import {NFTAssetType, WrappedNFTInfo, NFTVoucherRequest, ProvenanceEntry} from "../../src/bridge/nfteil/INFTEIL.sol";

/**
 * @title MockMailbox
 * @notice Mock Hyperlane mailbox that actually delivers messages
 */
contract MockMailbox {
    uint32 public localDomain;
    uint256 private _nonce;
    
    // Store pending messages
    struct PendingMessage {
        uint32 origin;
        bytes32 sender;
        bytes message;
    }
    
    mapping(bytes32 => PendingMessage) public pendingMessages;
    
    // Connected routers
    mapping(uint32 => address) public domainRouters;

    constructor(uint32 _domain) {
        localDomain = _domain;
    }

    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId) {
        messageId = keccak256(abi.encodePacked(block.number, _nonce++, msg.sender));
        
        // Store message for delivery
        pendingMessages[messageId] = PendingMessage({
            origin: localDomain,
            sender: bytes32(uint256(uint160(msg.sender))),
            message: messageBody
        });
        
        return messageId;
    }

    function deliverMessage(bytes32 messageId, address router) external {
        PendingMessage memory pending = pendingMessages[messageId];
        require(pending.message.length > 0, "No pending message");
        
        // Call the router's handle function
        (bool success, bytes memory reason) = router.call(
            abi.encodeWithSignature(
                "handle(uint32,bytes32,bytes)",
                pending.origin,
                pending.sender,
                pending.message
            )
        );
        
        require(success, string(reason));
        delete pendingMessages[messageId];
    }
}

/**
 * @title MockIGP
 * @notice Mock gas paymaster
 */
contract MockIGP {
    function payForGas(bytes32, uint32, uint256, address) external payable {}
    function quoteGasPayment(uint32, uint256) external pure returns (uint256) { return 0.001 ether; }
}

/**
 * @title HomeChainNFT
 * @notice Concrete NFT on home chain
 */
contract HomeChainNFT is CrossChainNFT {
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

    function setRoyalty(uint256 tokenId, address receiver, uint96 feeBps) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeBps);
    }
}

/**
 * @title SyntheticChainNFT
 * @notice Synthetic NFT on destination chain
 */
contract SyntheticChainNFT is CrossChainNFT {
    constructor(address mailbox, address igp) CrossChainNFT("Synthetic NFT", "SNFT", msg.sender) {
        _initializeCrossChain(mailbox, igp, 2, false);
    }
}

/**
 * @title HomeChainMultiToken
 * @notice Concrete ERC1155 on home chain
 */
contract HomeChainMultiToken is CrossChainMultiToken {
    constructor(address mailbox, address igp) CrossChainMultiToken("https://tokens/{id}.json", msg.sender) {
        _initializeCrossChain(mailbox, igp, 1, true);
    }

    function mint(address to, uint256 tokenId, uint256 amount, string memory uri) external {
        _mint(to, tokenId, amount, "");
        _setURI(tokenId, uri);
    }
}

/**
 * @title SyntheticChainMultiToken
 */
contract SyntheticChainMultiToken is CrossChainMultiToken {
    constructor(address mailbox, address igp) CrossChainMultiToken("https://tokens/{id}.json", msg.sender) {
        _initializeCrossChain(mailbox, igp, 2, false);
    }
}

/**
 * @title CrossChainNFTIntegrationTest
 * @notice Full E2E integration tests for cross-chain NFT transfers
 */
contract CrossChainNFTIntegrationTest is Test {
    // Chain 1 (Home)
    MockMailbox public mailboxHome;
    MockIGP public igpHome;
    HomeChainNFT public nftHome;
    HomeChainMultiToken public multiTokenHome;
    NFTPaymaster public paymasterHome;

    // Chain 2 (Destination)
    MockMailbox public mailboxDest;
    MockIGP public igpDest;
    SyntheticChainNFT public nftDest;
    SyntheticChainMultiToken public multiTokenDest;
    WrappedNFT public wrappedNFT;

    // Users and operators
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public xlp = address(4);
    address public royaltyReceiver = address(5);

    uint32 constant HOME_DOMAIN = 1;
    uint32 constant DEST_DOMAIN = 2;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy Chain 1 infrastructure
        mailboxHome = new MockMailbox(HOME_DOMAIN);
        igpHome = new MockIGP();
        nftHome = new HomeChainNFT(address(mailboxHome), address(igpHome));
        multiTokenHome = new HomeChainMultiToken(address(mailboxHome), address(igpHome));
        paymasterHome = new NFTPaymaster(HOME_DOMAIN, address(0x999));
        paymasterHome.setSupportedCollection(address(nftHome), true);

        // Deploy Chain 2 infrastructure
        mailboxDest = new MockMailbox(DEST_DOMAIN);
        igpDest = new MockIGP();
        nftDest = new SyntheticChainNFT(address(mailboxDest), address(igpDest));
        multiTokenDest = new SyntheticChainMultiToken(address(mailboxDest), address(igpDest));
        wrappedNFT = new WrappedNFT("Wrapped NFT", "WNFT", owner);

        // Configure routers
        nftHome.setRouter(DEST_DOMAIN, bytes32(uint256(uint160(address(nftDest)))));
        nftHome.setDomainEnabled(DEST_DOMAIN, true);
        
        nftDest.setRouter(HOME_DOMAIN, bytes32(uint256(uint160(address(nftHome)))));
        nftDest.setDomainEnabled(HOME_DOMAIN, true);

        multiTokenHome.setRouter(DEST_DOMAIN, bytes32(uint256(uint160(address(multiTokenDest)))));
        multiTokenHome.setDomainEnabled(DEST_DOMAIN, true);
        
        multiTokenDest.setRouter(HOME_DOMAIN, bytes32(uint256(uint160(address(multiTokenHome)))));
        multiTokenDest.setDomainEnabled(HOME_DOMAIN, true);

        // Authorize bridges
        wrappedNFT.authorizeBridge(owner, true);
        wrappedNFT.authorizeBridge(address(nftDest), true);

        vm.stopPrank();

        // Fund users
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(xlp, 100 ether);
    }

    // =========================================================================
    // E2E TEST: Full Round-Trip Bridge (ERC721)
    // =========================================================================
    
    function test_E2E_ERC721_RoundTrip() public {
        console.log("=== E2E Test: ERC721 Round-Trip Bridge ===");

        // Step 1: Mint NFT on home chain
        console.log("Step 1: Mint NFT on home chain");
        vm.prank(owner);
        uint256 tokenId = nftHome.mint(user1, "ipfs://original-metadata");
        
        assertEq(nftHome.ownerOf(tokenId), user1);
        assertEq(nftHome.tokenURI(tokenId), "ipfs://original-metadata");
        console.log("  - Minted tokenId:", tokenId);
        console.log("  - Owner:", user1);

        // Step 2: Bridge to destination chain
        console.log("Step 2: Bridge NFT to destination chain");
        bytes32 recipient = bytes32(uint256(uint160(user1)));
        
        vm.startPrank(user1);
        bytes32 messageId = nftHome.bridgeNFT{value: 0.01 ether}(DEST_DOMAIN, recipient, tokenId);
        vm.stopPrank();
        
        // Verify locked on home chain
        assertEq(nftHome.ownerOf(tokenId), address(nftHome));
        assertTrue(nftHome.lockedTokens(tokenId));
        console.log("  - NFT locked on home chain");
        console.log("  - Message ID:", uint256(messageId));

        // Step 3: Deliver message to destination
        console.log("Step 3: Deliver message to destination chain");
        vm.prank(address(mailboxDest));
        nftDest.handle(
            HOME_DOMAIN,
            bytes32(uint256(uint160(address(nftHome)))),
            _buildTransferMessage(recipient, tokenId, "ipfs://original-metadata")
        );

        // Verify minted on destination
        assertEq(nftDest.ownerOf(tokenId), user1);
        assertEq(nftDest.tokenURI(tokenId), "ipfs://original-metadata");
        console.log("  - NFT minted on destination chain");
        console.log("  - Owner on dest:", user1);

        // Step 4: Check provenance on destination
        console.log("Step 4: Verify provenance tracking");
        ProvenanceEntry[] memory provenance = nftDest.getProvenance(tokenId);
        assertEq(provenance.length, 1);
        assertEq(provenance[0].owner, user1);
        console.log("  - Provenance entries:", provenance.length);

        // Step 5: Bridge back to home chain
        console.log("Step 5: Bridge NFT back to home chain");
        bytes32 returnRecipient = bytes32(uint256(uint160(user1)));
        
        vm.startPrank(user1);
        bytes32 returnMessageId = nftDest.bridgeNFT{value: 0.01 ether}(HOME_DOMAIN, returnRecipient, tokenId);
        vm.stopPrank();

        // Verify burned on destination
        vm.expectRevert();
        nftDest.ownerOf(tokenId);
        console.log("  - NFT burned on destination chain");

        // Step 6: Deliver return message
        console.log("Step 6: Deliver return message to home chain");
        vm.prank(address(mailboxHome));
        nftHome.handle(
            DEST_DOMAIN,
            bytes32(uint256(uint160(address(nftDest)))),
            _buildTransferMessage(returnRecipient, tokenId, "ipfs://original-metadata")
        );

        // Verify unlocked and returned to user
        assertEq(nftHome.ownerOf(tokenId), user1);
        assertFalse(nftHome.lockedTokens(tokenId));
        console.log("  - NFT unlocked on home chain");
        console.log("  - Final owner:", user1);

        // Step 7: Verify final stats
        console.log("Step 7: Verify cross-chain statistics");
        (uint256 bridgedOut, uint256 bridgedIn, , ) = nftHome.getCrossChainStats();
        assertEq(bridgedOut, 1);
        assertEq(bridgedIn, 1);
        console.log("  - Home chain bridged out:", bridgedOut);
        console.log("  - Home chain bridged in:", bridgedIn);

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // E2E TEST: Full Round-Trip Bridge (ERC1155)
    // =========================================================================

    function test_E2E_ERC1155_RoundTrip() public {
        console.log("=== E2E Test: ERC1155 Round-Trip Bridge ===");

        // Step 1: Mint multiple tokens on home chain
        console.log("Step 1: Mint 100 tokens of tokenId 42 on home chain");
        vm.prank(owner);
        multiTokenHome.mint(user1, 42, 100, "ipfs://token-42-metadata");
        
        assertEq(multiTokenHome.balanceOf(user1, 42), 100);
        console.log("  - Minted 100 tokens");

        // Step 2: Bridge 50 tokens to destination
        console.log("Step 2: Bridge 50 tokens to destination");
        bytes32 recipient = bytes32(uint256(uint160(user1)));
        
        vm.startPrank(user1);
        multiTokenHome.bridgeMultiToken{value: 0.01 ether}(DEST_DOMAIN, recipient, 42, 50);
        vm.stopPrank();

        // Verify balance on home chain
        assertEq(multiTokenHome.balanceOf(user1, 42), 50);
        assertEq(multiTokenHome.lockedBalances(42), 50);
        console.log("  - 50 locked on home chain");
        console.log("  - 50 remain with user");

        // Step 3: Deliver to destination
        console.log("Step 3: Deliver to destination chain");
        vm.prank(address(mailboxDest));
        multiTokenDest.handle(
            HOME_DOMAIN,
            bytes32(uint256(uint160(address(multiTokenHome)))),
            _buildMultiTokenTransferMessage(recipient, 42, 50, "ipfs://token-42-metadata")
        );

        assertEq(multiTokenDest.balanceOf(user1, 42), 50);
        console.log("  - 50 minted on destination");

        // Step 4: Bridge back 25
        console.log("Step 4: Bridge back 25 tokens");
        bytes32 returnRecipient = bytes32(uint256(uint160(user1)));
        
        vm.startPrank(user1);
        multiTokenDest.bridgeMultiToken{value: 0.01 ether}(HOME_DOMAIN, returnRecipient, 42, 25);
        vm.stopPrank();

        assertEq(multiTokenDest.balanceOf(user1, 42), 25);
        console.log("  - 25 remain on destination");

        // Step 5: Deliver return
        console.log("Step 5: Deliver return to home chain");
        vm.prank(address(mailboxHome));
        multiTokenHome.handle(
            DEST_DOMAIN,
            bytes32(uint256(uint160(address(multiTokenDest)))),
            _buildMultiTokenTransferMessage(returnRecipient, 42, 25, "ipfs://token-42-metadata")
        );

        // Final balances
        assertEq(multiTokenHome.balanceOf(user1, 42), 75); // 50 original + 25 returned
        assertEq(multiTokenDest.balanceOf(user1, 42), 25); // Still on dest
        console.log("  - Home chain balance: 75");
        console.log("  - Dest chain balance: 25");

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // E2E TEST: Wrapped NFT with Provenance
    // =========================================================================

    function test_E2E_WrappedNFT_Provenance() public {
        console.log("=== E2E Test: Wrapped NFT with Full Provenance ===");

        // Step 1: Create wrapped NFT (simulating bridge receipt)
        console.log("Step 1: Wrap NFT from home chain");
        vm.startPrank(owner);
        uint256 wrappedId = wrappedNFT.wrap(
            HOME_DOMAIN,
            address(0xBEEF),  // Original collection
            999,               // Original tokenId
            "ipfs://original-999",
            user1
        );
        vm.stopPrank();

        assertEq(wrappedId, 999); // Preserves original tokenId
        assertEq(wrappedNFT.ownerOf(999), user1);
        assertTrue(wrappedNFT.isWrapped(999));
        console.log("  - Wrapped tokenId:", wrappedId);

        // Step 2: Verify original info
        console.log("Step 2: Verify original info is preserved");
        WrappedNFTInfo memory info = wrappedNFT.getOriginalInfo(999);
        assertEq(info.homeChainId, HOME_DOMAIN);
        assertEq(info.originalCollection, address(0xBEEF));
        assertEq(info.originalTokenId, 999);
        assertEq(info.tokenURI, "ipfs://original-999");
        console.log("  - Original chain:", info.homeChainId);
        console.log("  - Original collection:", info.originalCollection);

        // Step 3: Check provenance
        console.log("Step 3: Check provenance history");
        ProvenanceEntry[] memory prov = wrappedNFT.getProvenance(999);
        assertEq(prov.length, 1);
        assertEq(prov[0].owner, user1);
        console.log("  - Provenance entries:", prov.length);

        // Step 4: Transfer wrapped NFT
        console.log("Step 4: Transfer wrapped NFT to user2");
        vm.prank(user1);
        wrappedNFT.transferFrom(user1, user2, 999);
        
        assertEq(wrappedNFT.ownerOf(999), user2);
        console.log("  - New owner:", user2);

        // Step 5: User2 unwraps
        console.log("Step 5: Unwrap NFT (initiate return to home chain)");
        vm.prank(user2);
        wrappedNFT.unwrap(999);

        assertFalse(wrappedNFT.isWrapped(999));
        console.log("  - NFT unwrapped");

        // Verify burned
        vm.expectRevert();
        wrappedNFT.ownerOf(999);
        console.log("  - Wrapped token burned");

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // E2E TEST: XLP Fast Path
    // =========================================================================

    function test_E2E_XLP_FastPath() public {
        console.log("=== E2E Test: XLP Fast Path Transfer ===");

        // Step 1: Setup XLP
        console.log("Step 1: Setup XLP with stake and wrapped collection");
        vm.startPrank(owner);
        paymasterHome.updateXLPStake(xlp, 1 ether);
        vm.stopPrank();

        vm.prank(xlp);
        paymasterHome.registerWrappedCollection(HOME_DOMAIN, address(nftHome), address(wrappedNFT));
        console.log("  - XLP registered wrapped collection");

        // Step 2: Mint NFT
        console.log("Step 2: Mint NFT to user");
        vm.prank(owner);
        uint256 tokenId = nftHome.mint(user1, "ipfs://fast-path-nft");
        console.log("  - Minted tokenId:", tokenId);

        // Step 3: Create voucher request
        console.log("Step 3: Create voucher request");
        vm.startPrank(user1);
        nftHome.approve(address(paymasterHome), tokenId);
        
        bytes32 requestId = paymasterHome.createNFTVoucherRequest{value: 0.01 ether}(
            NFTAssetType.ERC721,
            address(nftHome),
            tokenId,
            1,
            DEST_DOMAIN,
            user1,
            0.001 ether,
            0.01 ether,
            0.0001 ether
        );
        vm.stopPrank();

        // Verify NFT locked
        assertEq(nftHome.ownerOf(tokenId), address(paymasterHome));
        console.log("  - Request ID:", uint256(requestId));
        console.log("  - NFT locked in paymaster");

        // Step 4: Check fee auction
        console.log("Step 4: Verify fee auction mechanism");
        uint256 fee1 = paymasterHome.getCurrentFee(requestId);
        vm.roll(block.number + 10);
        uint256 fee2 = paymasterHome.getCurrentFee(requestId);
        assertTrue(fee2 > fee1);
        console.log("  - Fee at start:", fee1);
        console.log("  - Fee after 10 blocks:", fee2);

        // Step 5: Verify request can be fulfilled
        console.log("Step 5: Verify request can be fulfilled");
        assertTrue(paymasterHome.canFulfillRequest(requestId));
        
        NFTVoucherRequest memory request = paymasterHome.getRequest(requestId);
        assertEq(request.requester, user1);
        assertEq(request.collection, address(nftHome));
        assertEq(request.tokenId, tokenId);
        console.log("  - Request is valid for fulfillment");

        // Step 6: Test expiry and refund
        console.log("Step 6: Test expiry and refund");
        vm.roll(block.number + 200); // Past deadline
        
        uint256 balBefore = user1.balance;
        paymasterHome.refundExpiredRequest(requestId);
        uint256 balAfter = user1.balance;
        
        // NFT returned
        assertEq(nftHome.ownerOf(tokenId), user1);
        // Fee returned
        assertTrue(balAfter > balBefore);
        console.log("  - NFT refunded to user");
        console.log("  - Fee refunded to user");

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // E2E TEST: Royalty Enforcement
    // =========================================================================

    function test_E2E_RoyaltyEnforcement() public {
        console.log("=== E2E Test: Royalty Enforcement Across Chains ===");

        // Step 1: Set royalty on home chain NFT
        console.log("Step 1: Set royalty on home chain");
        vm.startPrank(owner);
        uint256 tokenId = nftHome.mint(user1, "ipfs://royalty-test");
        nftHome.setRoyalty(tokenId, royaltyReceiver, 500); // 5%
        vm.stopPrank();

        // Step 2: Verify royalty on home chain
        console.log("Step 2: Verify royalty calculation on home chain");
        (address receiver, uint256 amount) = nftHome.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, royaltyReceiver);
        assertEq(amount, 0.05 ether);
        console.log("  - Royalty receiver:", receiver);
        console.log("  - Royalty on 1 ETH:", amount);

        // Step 3: Set royalty on wrapped NFT
        console.log("Step 3: Set royalty on wrapped NFT collection");
        vm.prank(owner);
        wrappedNFT.setUniversalRoyalty(HOME_DOMAIN, address(nftHome), royaltyReceiver, 500);

        // Step 4: Create wrapped NFT and verify royalty
        console.log("Step 4: Verify royalty on wrapped NFT");
        vm.prank(owner);
        wrappedNFT.wrap(HOME_DOMAIN, address(nftHome), 123, "ipfs://royalty-wrapped", user1);

        (address wrappedReceiver, uint256 wrappedAmount) = wrappedNFT.getRoyaltyInfo(123, 1 ether);
        assertEq(wrappedReceiver, royaltyReceiver);
        assertEq(wrappedAmount, 0.05 ether);
        console.log("  - Wrapped royalty receiver:", wrappedReceiver);
        console.log("  - Wrapped royalty on 1 ETH:", wrappedAmount);

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // E2E TEST: Batch Bridge (ERC1155)
    // =========================================================================

    function test_E2E_BatchBridge() public {
        console.log("=== E2E Test: Batch Bridge Multiple Token Types ===");

        // Step 1: Mint multiple token types
        console.log("Step 1: Mint multiple token types");
        vm.startPrank(owner);
        multiTokenHome.mint(user1, 1, 100, "ipfs://token-1");
        multiTokenHome.mint(user1, 2, 50, "ipfs://token-2");
        multiTokenHome.mint(user1, 3, 25, "ipfs://token-3");
        vm.stopPrank();

        console.log("  - Token 1: 100 units");
        console.log("  - Token 2: 50 units");
        console.log("  - Token 3: 25 units");

        // Step 2: Batch bridge
        console.log("Step 2: Batch bridge all tokens");
        uint256[] memory tokenIds = new uint256[](3);
        uint256[] memory amounts = new uint256[](3);
        tokenIds[0] = 1; amounts[0] = 50;
        tokenIds[1] = 2; amounts[1] = 25;
        tokenIds[2] = 3; amounts[2] = 10;

        bytes32 recipient = bytes32(uint256(uint160(user1)));
        
        vm.startPrank(user1);
        bytes32 messageId = multiTokenHome.bridgeBatch{value: 0.02 ether}(
            DEST_DOMAIN,
            recipient,
            tokenIds,
            amounts
        );
        vm.stopPrank();

        // Verify balances
        assertEq(multiTokenHome.balanceOf(user1, 1), 50);  // 100 - 50
        assertEq(multiTokenHome.balanceOf(user1, 2), 25);  // 50 - 25
        assertEq(multiTokenHome.balanceOf(user1, 3), 15);  // 25 - 10
        console.log("  - Message ID:", uint256(messageId));
        console.log("  - Batch bridge successful");

        // Step 3: Verify locked balances
        console.log("Step 3: Verify locked balances");
        assertEq(multiTokenHome.lockedBalances(1), 50);
        assertEq(multiTokenHome.lockedBalances(2), 25);
        assertEq(multiTokenHome.lockedBalances(3), 10);
        console.log("  - Token 1 locked: 50");
        console.log("  - Token 2 locked: 25");
        console.log("  - Token 3 locked: 10");

        console.log("=== E2E Test PASSED ===");
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    function _buildTransferMessage(
        bytes32 recipient,
        uint256 tokenId,
        string memory uri
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            bytes1(0x01), // MESSAGE_TYPE_TRANSFER
            recipient,
            tokenId,
            uri
        );
    }

    function _buildMultiTokenTransferMessage(
        bytes32 recipient,
        uint256 tokenId,
        uint256 amount,
        string memory uri
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            bytes1(0x01), // MESSAGE_TYPE_TRANSFER
            recipient,
            tokenId,
            amount,
            uri
        );
    }
}
