// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ICrossChainBridge.sol";

/**
 * @title CrossChainToken
 * @notice ERC20 token designed for seamless cross-chain transfers
 * @dev Similar to CCIP tokens - can be minted/burned by authorized bridges
 *
 * Features:
 * - Native cross-chain support (no wrapping)
 * - Authorized bridge minting/burning
 * - Total supply consistency across chains
 * - Metadata immutability for cross-chain consistency
 */
contract CrossChainToken {
    // =============================================================================
    // STATE
    // =============================================================================

    /// @notice Token name
    string public name;

    /// @notice Token symbol
    string public symbol;

    /// @notice Token decimals (same on all chains)
    uint8 public immutable decimals;

    /// @notice Total supply on THIS chain
    uint256 public totalSupply;

    /// @notice Balance of each account
    mapping(address => uint256) public balanceOf;

    /// @notice Allowances
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Authorized bridges that can mint/burn
    mapping(address => bool) public authorizedBridges;

    /// @notice Admin for managing bridges
    address public admin;

    /// @notice Home chain ID where token was originally deployed
    uint256 public immutable homeChainId;

    /// @notice Whether this deployment is on the home chain
    bool public immutable isHomeChain;

    /// @notice Unique token ID across all chains
    bytes32 public immutable tokenId;

    /// @notice Corresponding Solana token mint (if applicable)
    bytes32 public solanaMint;

    // =============================================================================
    // EVENTS
    // =============================================================================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BridgeAuthorized(address indexed bridge, bool authorized);
    event BridgeMint(address indexed bridge, address indexed to, uint256 amount);
    event BridgeBurn(address indexed bridge, address indexed from, uint256 amount);

    // =============================================================================
    // ERRORS
    // =============================================================================

    error OnlyAdmin();
    error OnlyBridge();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    // =============================================================================
    // MODIFIERS
    // =============================================================================

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyBridge() {
        if (!authorizedBridges[msg.sender]) revert OnlyBridge();
        _;
    }

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _homeChainId,
        uint256 _initialSupply,
        address _initialHolder
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        homeChainId = _homeChainId;
        isHomeChain = block.chainid == _homeChainId;
        admin = msg.sender;

        // Generate unique token ID from deployment parameters
        tokenId = keccak256(
            abi.encodePacked(_name, _symbol, _decimals, _homeChainId, address(this))
        );

        // Mint initial supply only on home chain
        if (isHomeChain && _initialSupply > 0) {
            _mint(_initialHolder, _initialSupply);
        }
    }

    // =============================================================================
    // ERC20 FUNCTIONS
    // =============================================================================

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    // =============================================================================
    // BRIDGE FUNCTIONS
    // =============================================================================

    /**
     * @notice Mint tokens (only callable by authorized bridges)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function bridgeMint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
        emit BridgeMint(msg.sender, to, amount);
    }

    /**
     * @notice Burn tokens (only callable by authorized bridges)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function bridgeBurn(address from, uint256 amount) external onlyBridge {
        _burn(from, amount);
        emit BridgeBurn(msg.sender, from, amount);
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Authorize or deauthorize a bridge
     * @param bridge Bridge address
     * @param authorized Whether to authorize
     */
    function setBridgeAuthorization(address bridge, bool authorized) external onlyAdmin {
        if (bridge == address(0)) revert ZeroAddress();
        authorizedBridges[bridge] = authorized;
        emit BridgeAuthorized(bridge, authorized);
    }

    /**
     * @notice Set the corresponding Solana mint address
     * @param _solanaMint Solana token mint pubkey
     */
    function setSolanaMint(bytes32 _solanaMint) external onlyAdmin {
        solanaMint = _solanaMint;
    }

    /**
     * @notice Transfer admin rights
     * @param newAdmin New admin address
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        if (from == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
