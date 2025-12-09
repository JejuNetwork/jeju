// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import {IJNS, IJNSRegistrar} from "./IJNS.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title JNSRegistrar
 * @author Jeju Network
 * @notice Name registration controller for the Jeju Name Service
 * @dev Manages name registration, renewal, and expiration as ERC-721 NFTs
 *
 * Architecture:
 * - Names are registered as ERC-721 tokens (tokenId = labelhash)
 * - Registration grants ownership of the name in JNSRegistry
 * - Names can be renewed by anyone (not just owner)
 * - Expired names become available after grace period
 *
 * Pricing Model:
 * - Base price: 0.001 ETH per year
 * - Short names (3-4 chars): Premium pricing
 * - Reserved names: Require governance approval
 * - Bulk discounts for multi-year registration
 *
 * ERC-8004 Integration:
 * - Registered agents get discounts
 * - Names can be linked to agents
 * - Agent reputation affects registration limits
 *
 * Name Validation:
 * - Minimum 3 characters
 * - Alphanumeric and hyphens only
 * - No leading/trailing hyphens
 * - No consecutive hyphens
 *
 * @custom:security-contact security@jeju.network
 */
contract JNSRegistrar is ERC721, Ownable, ReentrancyGuard, IJNSRegistrar {
    // ============ Constants ============

    /// @notice Base node for .jeju names (namehash("jeju"))
    bytes32 public constant BASE_NODE = keccak256(abi.encodePacked(bytes32(0), keccak256("jeju")));

    /// @notice Minimum registration duration (1 year in seconds)
    uint256 public constant MIN_REGISTRATION_DURATION = 365 days;

    /// @notice Grace period after expiration (90 days)
    uint256 public constant GRACE_PERIOD = 90 days;

    /// @notice Minimum name length
    uint256 public constant MIN_NAME_LENGTH = 3;

    /// @notice Base price per year (0.001 ETH)
    uint256 public constant BASE_PRICE = 0.001 ether;

    /// @notice Premium multiplier for 3-char names
    uint256 public constant PREMIUM_3_CHAR = 100; // 100x = 0.1 ETH/year

    /// @notice Premium multiplier for 4-char names
    uint256 public constant PREMIUM_4_CHAR = 10; // 10x = 0.01 ETH/year

    // ============ State Variables ============

    /// @notice The JNS registry
    IJNS public immutable jns;

    /// @notice Default resolver address
    address public defaultResolver;

    /// @notice Mapping from label hash to expiration timestamp
    mapping(bytes32 => uint256) private _expirations;

    /// @notice Mapping from label hash to original name string
    mapping(bytes32 => string) private _labelNames;

    /// @notice Reserved names that require governance approval
    mapping(bytes32 => bool) public reservedNames;

    /// @notice Optional ERC-8004 Identity Registry for agent discounts
    IIdentityRegistry public identityRegistry;

    /// @notice Agent discount in basis points (500 = 5% discount)
    uint256 public agentDiscountBps = 500;

    /// @notice Treasury address for registration fees
    address public treasury;

    /// @notice Total revenue collected
    uint256 public totalRevenue;

    /// @notice Total names registered
    uint256 public totalRegistrations;

    // ============ Events ============

    event DefaultResolverUpdated(address indexed oldResolver, address indexed newResolver);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event NameReserved(bytes32 indexed labelhash, string name, bool reserved);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event AgentDiscountUpdated(uint256 oldDiscount, uint256 newDiscount);

    // ============ Errors ============

    error NameNotAvailable(string name);
    error NameTooShort();
    error InvalidName();
    error DurationTooShort();
    error InsufficientPayment(uint256 required, uint256 provided);
    error NameIsReserved();
    error InvalidResolver();
    error RefundFailed();

    // ============ Constructor ============

    /**
     * @notice Initialize the registrar
     * @param _jns Address of the JNS registry
     * @param _defaultResolver Address of the default resolver
     * @param _treasury Address for fee collection
     */
    constructor(
        address _jns,
        address _defaultResolver,
        address _treasury
    ) ERC721("Jeju Name Service", "JNS") Ownable(msg.sender) {
        jns = IJNS(_jns);
        defaultResolver = _defaultResolver;
        treasury = _treasury;

        // Reserve some common names
        _reserveName("jeju", true);
        _reserveName("gateway", true);
        _reserveName("bazaar", true);
        _reserveName("compute", true);
        _reserveName("storage", true);
        _reserveName("indexer", true);
        _reserveName("cloud", true);
        _reserveName("admin", true);
        _reserveName("system", true);
    }

    // ============ Registration Functions ============

    /**
     * @notice Check if a name is available for registration
     * @param name The name to check (without .jeju suffix)
     * @return True if available
     */
    function available(string calldata name) public view override returns (bool) {
        bytes32 labelhash = keccak256(bytes(name));

        // Check if reserved
        if (reservedNames[labelhash]) return false;

        // Check if expired (including grace period)
        uint256 expires = _expirations[labelhash];
        if (expires == 0) return true;

        return block.timestamp > expires + GRACE_PERIOD;
    }

    /**
     * @notice Calculate the rent price for a name
     * @param name The name to price
     * @param duration Registration duration in seconds
     * @return The total price in wei
     */
    function rentPrice(string calldata name, uint256 duration) public view override returns (uint256) {
        return _calculatePrice(name, duration, address(0));
    }

    /**
     * @notice Calculate the rent price with agent discount
     * @param name The name to price
     * @param duration Registration duration in seconds
     * @param agentOwner Address of potential agent owner for discount
     * @return The total price in wei
     */
    function rentPriceWithDiscount(
        string calldata name,
        uint256 duration,
        address agentOwner
    ) public view returns (uint256) {
        return _calculatePrice(name, duration, agentOwner);
    }

    /**
     * @notice Register a name
     * @param name The name to register (without .jeju suffix)
     * @param owner_ Address to receive ownership
     * @param duration Registration duration in seconds
     * @return node The namehash of the registered name
     */
    function register(
        string calldata name,
        address owner_,
        uint256 duration
    ) external payable override nonReentrant returns (bytes32 node) {
        return _register(name, owner_, duration, defaultResolver, new bytes[](0));
    }

    /**
     * @notice Register a name with custom resolver and initial data
     * @param name The name to register
     * @param owner_ Address to receive ownership
     * @param duration Registration duration in seconds
     * @param resolver Resolver address (or address(0) for default)
     * @param data Resolver data to set (multicall format)
     * @return node The namehash of the registered name
     */
    function registerWithConfig(
        string calldata name,
        address owner_,
        uint256 duration,
        address resolver,
        bytes[] calldata data
    ) external payable override nonReentrant returns (bytes32 node) {
        address resolverAddr = resolver == address(0) ? defaultResolver : resolver;
        return _register(name, owner_, duration, resolverAddr, data);
    }

    /**
     * @notice Renew a name registration
     * @param name The name to renew
     * @param duration Additional duration in seconds
     */
    function renew(string calldata name, uint256 duration) external payable override nonReentrant {
        bytes32 labelhash = keccak256(bytes(name));

        uint256 expires = _expirations[labelhash];
        if (expires == 0) revert NameNotAvailable(name);
        if (block.timestamp > expires + GRACE_PERIOD) revert NameNotAvailable(name);

        uint256 price = _calculatePrice(name, duration, msg.sender);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        // Extend expiration
        uint256 newExpires = expires > block.timestamp
            ? expires + duration
            : block.timestamp + duration;

        _expirations[labelhash] = newExpires;
        totalRevenue += price;

        // Transfer fee to treasury
        _transferFunds(treasury, price);

        // Refund excess
        if (msg.value > price) {
            _transferFunds(msg.sender, msg.value - price);
        }

        emit NameRenewed(_namehash(labelhash), name, newExpires, price);
    }

    // ============ View Functions ============

    /**
     * @notice Get the expiration timestamp for a name
     * @param name The name to query
     * @return The expiration timestamp (0 if never registered)
     */
    function nameExpires(string calldata name) external view override returns (uint256) {
        return _expirations[keccak256(bytes(name))];
    }

    /**
     * @notice Get the owner of a name
     * @param name The name to query
     * @return The owner address (address(0) if expired or not registered)
     */
    function ownerOf(string calldata name) external view override returns (address) {
        bytes32 labelhash = keccak256(bytes(name));
        uint256 expires = _expirations[labelhash];

        if (expires == 0 || block.timestamp > expires) {
            return address(0);
        }

        return _ownerOf(uint256(labelhash));
    }

    /**
     * @notice Get the registered name from a labelhash
     * @param labelhash The label hash
     * @return The name string
     */
    function getName(bytes32 labelhash) external view returns (string memory) {
        return _labelNames[labelhash];
    }

    /**
     * @notice Check if a name is in grace period
     * @param name The name to check
     * @return True if in grace period
     */
    function inGracePeriod(string calldata name) external view returns (bool) {
        bytes32 labelhash = keccak256(bytes(name));
        uint256 expires = _expirations[labelhash];

        if (expires == 0) return false;

        return block.timestamp > expires && block.timestamp <= expires + GRACE_PERIOD;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the default resolver
     * @param _resolver New default resolver address
     */
    function setDefaultResolver(address _resolver) external onlyOwner {
        if (_resolver == address(0)) revert InvalidResolver();
        address oldResolver = defaultResolver;
        defaultResolver = _resolver;
        emit DefaultResolverUpdated(oldResolver, _resolver);
    }

    /**
     * @notice Set the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Reserve or unreserve a name
     * @param name The name to reserve
     * @param reserved True to reserve, false to unreserve
     */
    function setReserved(string calldata name, bool reserved) external onlyOwner {
        _reserveName(name, reserved);
    }

    /**
     * @notice Claim a reserved name (governance only)
     * @param name The reserved name to claim
     * @param owner_ Address to receive ownership
     * @param duration Registration duration
     * @return node The namehash
     */
    function claimReserved(
        string calldata name,
        address owner_,
        uint256 duration
    ) external payable onlyOwner returns (bytes32 node) {
        bytes32 labelhash = keccak256(bytes(name));
        if (!reservedNames[labelhash]) revert InvalidName();

        // Unreserve and register
        reservedNames[labelhash] = false;
        return _register(name, owner_, duration, defaultResolver, new bytes[](0));
    }

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry Address of the registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Set the agent discount
     * @param _discountBps Discount in basis points
     */
    function setAgentDiscount(uint256 _discountBps) external onlyOwner {
        require(_discountBps <= 5000, "Max 50% discount");
        uint256 oldDiscount = agentDiscountBps;
        agentDiscountBps = _discountBps;
        emit AgentDiscountUpdated(oldDiscount, _discountBps);
    }

    // ============ Internal Functions ============

    function _register(
        string memory name,
        address owner_,
        uint256 duration,
        address resolver,
        bytes[] memory data
    ) internal returns (bytes32 node) {
        // Validate name
        if (!_validateName(name)) revert InvalidName();
        if (bytes(name).length < MIN_NAME_LENGTH) revert NameTooShort();
        if (duration < MIN_REGISTRATION_DURATION) revert DurationTooShort();
        
        bytes32 labelhash = keccak256(bytes(name));
        if (!_isAvailable(labelhash)) revert NameNotAvailable(name);
        if (reservedNames[labelhash]) revert NameIsReserved();

        // Calculate price
        uint256 price = _calculatePrice(name, duration, msg.sender);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        // Store name and expiration
        _labelNames[labelhash] = name;
        _expirations[labelhash] = block.timestamp + duration;
        totalRegistrations++;
        totalRevenue += price;

        // Mint NFT (safe mint to ensure receiver supports ERC721)
        _safeMint(owner_, uint256(labelhash));

        // Set up in JNS registry
        node = _namehash(labelhash);
        jns.setSubnodeRecord(BASE_NODE, labelhash, owner_, resolver, uint64(block.timestamp + duration));

        // Execute resolver data if provided
        if (data.length > 0 && resolver != address(0)) {
            for (uint256 i = 0; i < data.length; i++) {
                (bool success,) = resolver.call(data[i]);
                require(success, "Resolver call failed");
            }
        }

        // Transfer fee to treasury
        _transferFunds(treasury, price);

        // Refund excess
        if (msg.value > price) {
            _transferFunds(msg.sender, msg.value - price);
        }

        emit NameRegistered(node, name, owner_, block.timestamp + duration, price);
    }

    function _calculatePrice(
        string memory name,
        uint256 duration,
        address discountRecipient
    ) internal view returns (uint256) {
        uint256 len = bytes(name).length;
        uint256 yearlyPrice = BASE_PRICE;

        // Apply length-based premium
        if (len == 3) {
            yearlyPrice = BASE_PRICE * PREMIUM_3_CHAR;
        } else if (len == 4) {
            yearlyPrice = BASE_PRICE * PREMIUM_4_CHAR;
        }

        // Calculate total price
        uint256 yearCount = duration / 365 days;
        uint256 price = yearlyPrice * yearCount;

        // Add partial year
        uint256 remaining = duration % 365 days;
        if (remaining > 0) {
            price += (yearlyPrice * remaining) / 365 days;
        }

        // Apply agent discount if applicable
        if (discountRecipient != address(0) && address(identityRegistry) != address(0)) {
            // Check if user owns any agent
            // Note: This is a simplified check - could be enhanced
            uint256 balance = identityRegistry.balanceOf(discountRecipient);
            if (balance > 0) {
                price = price - (price * agentDiscountBps / 10000);
            }
        }

        return price;
    }

    function _isAvailable(bytes32 labelhash) internal view returns (bool) {
        if (reservedNames[labelhash]) return false;
        uint256 expires = _expirations[labelhash];
        if (expires == 0) return true;
        return block.timestamp > expires + GRACE_PERIOD;
    }

    function _validateName(string memory name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);

        // Check each character
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];

            // Allow lowercase letters, numbers, and hyphens
            bool isLowercase = char >= 0x61 && char <= 0x7a; // a-z
            bool isNumber = char >= 0x30 && char <= 0x39;    // 0-9
            bool isHyphen = char == 0x2d;                     // -

            if (!isLowercase && !isNumber && !isHyphen) {
                return false;
            }

            // No leading or trailing hyphens
            if (isHyphen && (i == 0 || i == nameBytes.length - 1)) {
                return false;
            }

            // No consecutive hyphens
            if (isHyphen && i > 0 && nameBytes[i - 1] == 0x2d) {
                return false;
            }
        }

        return true;
    }

    function _namehash(bytes32 labelhash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(BASE_NODE, labelhash));
    }

    function _reserveName(string memory name, bool reserved) internal {
        bytes32 labelhash = keccak256(bytes(name));
        reservedNames[labelhash] = reserved;
        emit NameReserved(labelhash, name, reserved);
    }

    function _transferFunds(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert RefundFailed();
    }

    // ============ ERC-721 Overrides ============

    /**
     * @notice Override transfer to update JNS registry
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = super._update(to, tokenId, auth);

        // Update JNS registry owner
        if (to != address(0)) {
            bytes32 labelhash = bytes32(tokenId);
            bytes32 node = _namehash(labelhash);

            // Only update if not expired
            if (_expirations[labelhash] >= block.timestamp) {
                jns.setSubnodeOwner(BASE_NODE, labelhash, to);
            }

            emit NameTransferred(node, from, to);
        }

        return from;
    }

    /**
     * @notice Returns the token URI for a name
     * @param tokenId The token ID (labelhash)
     * @return The URI string
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory name = _labelNames[bytes32(tokenId)];
        return string(abi.encodePacked(
            "https://names.jeju.network/metadata/",
            name,
            ".json"
        ));
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice Allow contract to receive ETH
     */
    receive() external payable {}
}

