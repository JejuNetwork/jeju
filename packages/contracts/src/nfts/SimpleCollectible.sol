// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleCollectible
 * @author Jeju Network
 * @notice Simple ERC721 contract for user-minted collectibles
 * @dev Features:
 *      - Public minting with optional fee
 *      - User-provided metadata URI
 *      - Enumerable for easy listing
 *      - No cap on total supply by default
 */
contract SimpleCollectible is
    ERC721Enumerable,
    ERC721URIStorage,
    Ownable,
    ReentrancyGuard
{
    // =========================================================================
    // State
    // =========================================================================

    /// @notice Next token ID
    uint256 private _nextTokenId = 1;

    /// @notice Mint fee in ETH (0 = free)
    uint256 public mintFee;

    /// @notice Fee recipient
    address public feeRecipient;

    /// @notice Max supply (0 = unlimited)
    uint256 public maxSupply;

    /// @notice Max mints per address (0 = unlimited)
    uint256 public maxPerAddress;

    /// @notice Mints per address
    mapping(address => uint256) public mintCount;

    // =========================================================================
    // Events
    // =========================================================================

    event ItemMinted(uint256 indexed tokenId, address indexed minter, string tokenURI);
    event MintFeeUpdated(uint256 newFee);
    event FeeRecipientUpdated(address newRecipient);

    // =========================================================================
    // Errors
    // =========================================================================

    error InsufficientPayment();
    error MaxSupplyReached();
    error MaxPerAddressReached();
    error WithdrawFailed();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(
        string memory _name,
        string memory _symbol,
        address _owner,
        uint256 _mintFee,
        address _feeRecipient,
        uint256 _maxSupply,
        uint256 _maxPerAddress
    ) ERC721(_name, _symbol) Ownable(_owner) {
        mintFee = _mintFee;
        feeRecipient = _feeRecipient == address(0) ? _owner : _feeRecipient;
        maxSupply = _maxSupply;
        maxPerAddress = _maxPerAddress;
    }

    // =========================================================================
    // Minting
    // =========================================================================

    /**
     * @notice Mint a new collectible with custom metadata
     * @param _tokenURI The metadata URI for the token (IPFS or HTTP URL)
     * @return tokenId The minted token ID
     */
    function mint(string calldata _tokenURI) external payable nonReentrant returns (uint256 tokenId) {
        // Check payment
        if (msg.value < mintFee) revert InsufficientPayment();

        // Check max supply
        if (maxSupply > 0 && _nextTokenId > maxSupply) revert MaxSupplyReached();

        // Check per-address limit
        if (maxPerAddress > 0 && mintCount[msg.sender] >= maxPerAddress) {
            revert MaxPerAddressReached();
        }

        // Mint token
        tokenId = _nextTokenId++;
        mintCount[msg.sender]++;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, _tokenURI);

        // Transfer fee to recipient
        if (msg.value > 0 && feeRecipient != address(0)) {
            (bool sent, ) = feeRecipient.call{value: msg.value}("");
            if (!sent) revert WithdrawFailed();
        }

        emit ItemMinted(tokenId, msg.sender, _tokenURI);
    }

    /**
     * @notice Batch mint multiple tokens
     * @param _tokenURIs Array of metadata URIs
     * @return tokenIds Array of minted token IDs
     */
    function mintBatch(string[] calldata _tokenURIs) external payable nonReentrant returns (uint256[] memory tokenIds) {
        uint256 count = _tokenURIs.length;
        uint256 totalFee = mintFee * count;

        // Check payment
        if (msg.value < totalFee) revert InsufficientPayment();

        // Check max supply
        if (maxSupply > 0 && _nextTokenId + count - 1 > maxSupply) revert MaxSupplyReached();

        // Check per-address limit
        if (maxPerAddress > 0 && mintCount[msg.sender] + count > maxPerAddress) {
            revert MaxPerAddressReached();
        }

        tokenIds = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = _nextTokenId++;
            tokenIds[i] = tokenId;

            _safeMint(msg.sender, tokenId);
            _setTokenURI(tokenId, _tokenURIs[i]);

            emit ItemMinted(tokenId, msg.sender, _tokenURIs[i]);
        }

        mintCount[msg.sender] += count;

        // Transfer fee to recipient
        if (msg.value > 0 && feeRecipient != address(0)) {
            (bool sent, ) = feeRecipient.call{value: msg.value}("");
            if (!sent) revert WithdrawFailed();
        }
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get all tokens owned by an address
     * @param owner The owner address
     * @return tokenIds Array of token IDs
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 balance = balanceOf(owner);
        tokenIds = new uint256[](balance);
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    /**
     * @notice Get the next token ID that will be minted
     */
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @notice Get remaining mintable supply (0 if unlimited)
     */
    function remainingSupply() external view returns (uint256) {
        if (maxSupply == 0) return type(uint256).max;
        return maxSupply >= _nextTokenId - 1 ? maxSupply - (_nextTokenId - 1) : 0;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /**
     * @notice Set the mint fee
     */
    function setMintFee(uint256 _fee) external onlyOwner {
        mintFee = _fee;
        emit MintFeeUpdated(_fee);
    }

    /**
     * @notice Set the fee recipient
     */
    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(_recipient);
    }

    /**
     * @notice Set max supply (only can decrease or keep unlimited)
     */
    function setMaxSupply(uint256 _maxSupply) external onlyOwner {
        maxSupply = _maxSupply;
    }

    /**
     * @notice Set max mints per address
     */
    function setMaxPerAddress(uint256 _max) external onlyOwner {
        maxPerAddress = _max;
    }

    /**
     * @notice Withdraw any stuck ETH
     */
    function withdraw() external onlyOwner {
        (bool sent, ) = owner().call{value: address(this).balance}("");
        if (!sent) revert WithdrawFailed();
    }

    // =========================================================================
    // Overrides
    // =========================================================================

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
