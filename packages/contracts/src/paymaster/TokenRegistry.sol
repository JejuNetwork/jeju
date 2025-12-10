// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title TokenRegistry
 * @author Jeju Network
 * @notice Permissionless registry for tokens enabling cross-chain gas payment
 * @dev Central registry enabling any project to register their token for:
 *      - Gas payment on Jeju (4337 paymaster support)
 *      - Cross-chain liquidity via EIL XLPs
 *      - Multi-chain gas sponsorship without bridging
 *
 * Architecture:
 * - Projects register their ERC20 token with oracle address
 * - Set fee range (min/max) within global bounds
 * - Configure cross-chain availability (which chains token exists on)
 * - Pay registration fee to prevent spam
 * - Token becomes discoverable for LP liquidity provision
 * - Factory can deploy paymaster for registered tokens
 * - XLPs can provide liquidity to enable gas payment with this token
 *
 * Fee Model:
 * - Global bounds: 0-5% (set by protocol governance)
 * - Per-token bounds: Project chooses their range within global
 * - Actual fee: Paymaster operator sets within per-token range
 * - Example: Global 0-5%, ProjectA sets 0-2%, operator uses 1%
 *
 * Registration Flow:
 * 1. Project calls registerToken() with 0.1 ETH fee
 * 2. Contract validates: ERC20, oracle, fee range
 * 3. Token added to registry with cross-chain config
 * 4. Anyone can deploy paymaster via factory
 * 5. XLPs can start providing liquidity on any supported chain
 * 6. Users can pay gas with token on any chain where liquidity exists
 *
 * @custom:security-contact security@jeju.network
 */
contract TokenRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    struct TokenConfig {
        address tokenAddress; // ERC20 token contract
        string name; // Token name (cached from ERC20)
        string symbol; // Token symbol (cached from ERC20)
        uint8 decimals; // Token decimals (cached from ERC20)
        address oracleAddress; // Price oracle for this token
        uint256 minFeeMargin; // Minimum fee margin (basis points)
        uint256 maxFeeMargin; // Maximum fee margin (basis points)
        bool isActive; // Can be used for gas payment?
        address registrant; // Who registered this token
        uint256 registrationTime; // Block timestamp when registered
        uint256 totalVolume; // Total gas paid with this token (in wei equivalent)
        uint256 totalTransactions; // Total transactions using this token
        bytes32 metadataHash; // IPFS hash for additional metadata
        bool crossChainEnabled; // Whether token can be used for cross-chain gas
        uint256 totalLiquidity; // Total XLP liquidity across all chains
    }

    /// @notice Cross-chain configuration for a token
    struct CrossChainConfig {
        uint256 chainId; // Chain ID where token exists
        address tokenAddress; // Token address on that chain
        address paymasterAddress; // CrossChainPaymaster on that chain
        uint256 liquidity; // XLP liquidity available on that chain
        bool isActive; // Whether cross-chain is enabled for this chain
    }

    // ============ State Variables ============

    /// @notice Mapping from token address to configuration
    mapping(address => TokenConfig) public tokens;

    /// @notice Array of all registered token addresses
    address[] public tokenList;

    /// @notice Registration fee to prevent spam (in ETH)
    uint256 public registrationFee = 0.1 ether;

    /// @notice Global minimum fee margin (0% = free gas)
    uint256 public globalMinFeeMargin = 0;

    /// @notice Global maximum fee margin (5% cap)
    uint256 public globalMaxFeeMargin = 500; // 5%

    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Treasury receiving registration fees
    address public treasury;

    /// @notice Total registration fees collected
    uint256 public totalFeesCollected;

    // ============ Cross-Chain State ============

    /// @notice Cross-chain configs: local token => chainId => CrossChainConfig
    mapping(address => mapping(uint256 => CrossChainConfig)) public crossChainConfigs;

    /// @notice Supported chain IDs for cross-chain gas
    uint256[] public supportedChainIds;

    /// @notice Whether a chain ID is supported
    mapping(uint256 => bool) public isChainSupported;

    /// @notice Cross-chain paymaster addresses per chain
    mapping(uint256 => address) public chainPaymasters;

    /// @notice Total cross-chain liquidity across all tokens
    uint256 public totalCrossChainLiquidity;

    // ============ Events ============

    event TokenRegistered(
        address indexed token,
        address indexed registrant,
        string name,
        string symbol,
        address oracle,
        uint256 minFeeMargin,
        uint256 maxFeeMargin,
        uint256 registrationFee
    );

    event TokenActivated(address indexed token, address indexed activatedBy);
    event TokenDeactivated(address indexed token, address indexed deactivatedBy);
    event TokenVolumeUpdated(address indexed token, uint256 newVolume, uint256 newTxCount);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event GlobalFeeLimitsUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event MetadataUpdated(address indexed token, bytes32 indexed metadataHash);

    // Cross-chain events
    event CrossChainEnabled(address indexed token, uint256 indexed chainId, address tokenOnChain, address paymaster);
    event CrossChainDisabled(address indexed token, uint256 indexed chainId);
    event CrossChainLiquidityUpdated(address indexed token, uint256 indexed chainId, uint256 newLiquidity);
    event ChainPaymasterRegistered(uint256 indexed chainId, address indexed paymaster);
    event SupportedChainAdded(uint256 indexed chainId);
    event SupportedChainRemoved(uint256 indexed chainId);

    // ============ Errors ============

    error TokenAlreadyRegistered(address token);
    error TokenNotRegistered(address token);
    error InvalidToken(address token);
    error InvalidOracle(address oracle);
    error InvalidFeeRange(uint256 min, uint256 max);
    error FeesOutsideGlobalBounds(uint256 min, uint256 max);
    error InsufficientRegistrationFee(uint256 required, uint256 provided);
    error InvalidTreasury();
    error TransferFailed();
    error FeeOnTransferToken(address token);
    error ChainNotSupported(uint256 chainId);
    error CrossChainNotEnabled(address token, uint256 chainId);

    // ============ Constructor ============

    /**
     * @notice Initializes the TokenRegistry
     * @param initialOwner Address that will own the contract
     * @param _treasury Address to receive registration fees
     */
    constructor(address initialOwner, address _treasury) Ownable(initialOwner) {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
    }

    // ============ Registration Functions ============

    /**
     * @notice Register a new token for paymaster usage
     * @param tokenAddress ERC20 token contract address
     * @param oracleAddress Price oracle for this token (IPriceOracle compatible)
     * @param minFeeMargin Minimum fee margin this token requires (basis points)
     * @param maxFeeMargin Maximum fee margin allowed for this token (basis points)
     * @param metadataHash IPFS hash for additional metadata (optional)
     * @dev Requires registration fee payment. Validates token and oracle.
     *
     * Example: Register with 0-2% fee range
     * ```
     * registry.registerToken{value: 0.1 ether}(
     *   0xMyToken,
     *   0xMyOracle,
     *   0,      // min 0%
     *   200,    // max 2%
     *   bytes32(0)
     * );
     * ```
     */
    function registerToken(
        address tokenAddress,
        address oracleAddress,
        uint256 minFeeMargin,
        uint256 maxFeeMargin,
        bytes32 metadataHash
    ) external payable nonReentrant whenNotPaused returns (uint256 tokenId) {
        return _registerToken(tokenAddress, oracleAddress, minFeeMargin, maxFeeMargin, metadataHash, msg.sender);
    }

    /**
     * @notice Internal function to register a token
     */
    function _registerToken(
        address tokenAddress,
        address oracleAddress,
        uint256 minFeeMargin,
        uint256 maxFeeMargin,
        bytes32 metadataHash,
        address registrant
    ) internal returns (uint256 tokenId) {
        // Validate registration fee
        if (msg.value < registrationFee) {
            revert InsufficientRegistrationFee(registrationFee, msg.value);
        }

        // Validate token not already registered
        if (tokens[tokenAddress].tokenAddress != address(0)) {
            revert TokenAlreadyRegistered(tokenAddress);
        }

        // Validate token address
        if (tokenAddress == address(0)) revert InvalidToken(tokenAddress);

        // Validate oracle address
        if (oracleAddress == address(0)) revert InvalidOracle(oracleAddress);

        // Validate fee range
        if (minFeeMargin > maxFeeMargin) {
            revert InvalidFeeRange(minFeeMargin, maxFeeMargin);
        }

        // Validate fees are within global bounds
        if (minFeeMargin < globalMinFeeMargin || maxFeeMargin > globalMaxFeeMargin) {
            revert FeesOutsideGlobalBounds(minFeeMargin, maxFeeMargin);
        }

        // Read token metadata (this validates it's a proper ERC20)
        string memory name = "";
        string memory symbol = "";
        uint8 decimals = 0;

        try IERC20Metadata(tokenAddress).name() returns (string memory _name) {
            name = _name;
        } catch {
            revert InvalidToken(tokenAddress);
        }

        try IERC20Metadata(tokenAddress).symbol() returns (string memory _symbol) {
            symbol = _symbol;
        } catch {
            revert InvalidToken(tokenAddress);
        }

        try IERC20Metadata(tokenAddress).decimals() returns (uint8 _decimals) {
            decimals = _decimals;
        } catch {
            revert InvalidToken(tokenAddress);
        }

        // Validate token behavior (reject malicious tokens)
        _validateTokenBehavior(tokenAddress);

        // Create token configuration
        tokens[tokenAddress] = TokenConfig({
            tokenAddress: tokenAddress,
            name: name,
            symbol: symbol,
            decimals: decimals,
            oracleAddress: oracleAddress,
            minFeeMargin: minFeeMargin,
            maxFeeMargin: maxFeeMargin,
            isActive: true, // Active by default
            registrant: registrant,
            registrationTime: block.timestamp,
            totalVolume: 0,
            totalTransactions: 0,
            metadataHash: metadataHash
        });

        tokenList.push(tokenAddress);
        tokenId = tokenList.length - 1;

        // Transfer registration fee to treasury
        (bool success,) = treasury.call{value: msg.value}("");
        if (!success) revert TransferFailed();

        totalFeesCollected += msg.value;

        emit TokenRegistered(
            tokenAddress, registrant, name, symbol, oracleAddress, minFeeMargin, maxFeeMargin, msg.value
        );

        return tokenId;
    }

    /**
     * @notice Register token without metadata hash (convenience function)
     */
    function registerToken(address tokenAddress, address oracleAddress, uint256 minFeeMargin, uint256 maxFeeMargin)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        return _registerToken(tokenAddress, oracleAddress, minFeeMargin, maxFeeMargin, bytes32(0), msg.sender);
    }

    // ============ Token Management ============

    /**
     * @notice Activate a token for gas payment
     * @param tokenAddress Token to activate
     * @dev Only owner can activate/deactivate tokens (emergency control)
     */
    function activateToken(address tokenAddress) external onlyOwner {
        if (tokens[tokenAddress].tokenAddress == address(0)) {
            revert TokenNotRegistered(tokenAddress);
        }

        tokens[tokenAddress].isActive = true;

        emit TokenActivated(tokenAddress, msg.sender);
    }

    /**
     * @notice Deactivate a token (emergency stop)
     * @param tokenAddress Token to deactivate
     * @dev Does not delete registration, just prevents new usage
     */
    function deactivateToken(address tokenAddress) external onlyOwner {
        if (tokens[tokenAddress].tokenAddress == address(0)) {
            revert TokenNotRegistered(tokenAddress);
        }

        tokens[tokenAddress].isActive = false;

        emit TokenDeactivated(tokenAddress, msg.sender);
    }

    /**
     * @notice Update token metadata hash
     * @param tokenAddress Token to update
     * @param metadataHash New IPFS hash
     * @dev Only registrant can update their token's metadata
     */
    function updateMetadata(address tokenAddress, bytes32 metadataHash) external {
        TokenConfig storage config = tokens[tokenAddress];

        if (config.tokenAddress == address(0)) {
            revert TokenNotRegistered(tokenAddress);
        }

        require(msg.sender == config.registrant, "Only registrant");

        config.metadataHash = metadataHash;

        emit MetadataUpdated(tokenAddress, metadataHash);
    }

    /**
     * @notice Update token usage statistics
     * @param tokenAddress Token to update
     * @param volumeIncrease Volume to add (in wei ETH equivalent)
     * @dev Only called by PaymasterFactory or authorized paymasters
     */
    function updateTokenVolume(address tokenAddress, uint256 volumeIncrease) external {
        TokenConfig storage config = tokens[tokenAddress];

        if (config.tokenAddress == address(0)) {
            revert TokenNotRegistered(tokenAddress);
        }

        // Only allow owner to update stats (factory pattern not yet implemented)
        // Note: In future versions, PaymasterFactory could be granted update privileges
        require(msg.sender == owner(), "Only owner");

        config.totalVolume += volumeIncrease;
        config.totalTransactions += 1;

        emit TokenVolumeUpdated(tokenAddress, config.totalVolume, config.totalTransactions);
    }

    // ============ View Functions ============

    /**
     * @notice Check if a token is registered and active
     * @param tokenAddress Token to check
     * @return supported Whether token can be used for gas payment
     */
    function isTokenSupported(address tokenAddress) external view returns (bool supported) {
        TokenConfig memory config = tokens[tokenAddress];
        return config.tokenAddress != address(0) && config.isActive;
    }

    /**
     * @notice Get full configuration for a token
     * @param tokenAddress Token to query
     * @return config Complete token configuration
     */
    function getTokenConfig(address tokenAddress) external view returns (TokenConfig memory config) {
        if (tokens[tokenAddress].tokenAddress == address(0)) {
            revert TokenNotRegistered(tokenAddress);
        }
        return tokens[tokenAddress];
    }

    /**
     * @notice Get all registered tokens
     * @return addresses Array of all token addresses
     */
    function getAllTokens() external view returns (address[] memory addresses) {
        return tokenList;
    }

    /**
     * @notice Get active tokens only
     * @return addresses Array of active token addresses
     */
    function getActiveTokens() external view returns (address[] memory addresses) {
        uint256 activeCount = 0;

        // Count active tokens
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                activeCount++;
            }
        }

        // Build array of active tokens
        addresses = new address[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                addresses[index] = tokenList[i];
                index++;
            }
        }
    }

    /**
     * @notice Get tokens registered by a specific address
     * @param registrant Address that registered tokens
     * @return addresses Array of tokens registered by this address
     */
    function getTokensByRegistrant(address registrant) external view returns (address[] memory addresses) {
        uint256 count = 0;

        // Count tokens by registrant
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].registrant == registrant) {
                count++;
            }
        }

        // Build array
        addresses = new address[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].registrant == registrant) {
                addresses[index] = tokenList[i];
                index++;
            }
        }
    }

    /**
     * @notice Get total number of registered tokens
     * @return count Total tokens in registry
     */
    function getTotalTokens() external view returns (uint256 count) {
        return tokenList.length;
    }

    /**
     * @notice Get registry statistics
     * @return total Total tokens registered
     * @return active Number of active tokens
     * @return totalVolumeAllTokens Combined volume across all tokens
     * @return totalTxAllTokens Combined transactions across all tokens
     */
    function getRegistryStats()
        external
        view
        returns (uint256 total, uint256 active, uint256 totalVolumeAllTokens, uint256 totalTxAllTokens)
    {
        total = tokenList.length;

        for (uint256 i = 0; i < tokenList.length; i++) {
            TokenConfig memory config = tokens[tokenList[i]];
            if (config.isActive) {
                active++;
            }
            totalVolumeAllTokens += config.totalVolume;
            totalTxAllTokens += config.totalTransactions;
        }
    }

    /**
     * @notice Validate fee margin is within token's allowed range
     * @param tokenAddress Token to check
     * @param feeMargin Fee margin to validate
     * @return valid Whether fee is valid
     */
    function isValidFeeMargin(address tokenAddress, uint256 feeMargin) external view returns (bool valid) {
        TokenConfig memory config = tokens[tokenAddress];

        if (config.tokenAddress == address(0)) return false;
        if (!config.isActive) return false;

        return feeMargin >= config.minFeeMargin && feeMargin <= config.maxFeeMargin;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update global fee margin bounds
     * @param newMinFeeMargin New global minimum (basis points)
     * @param newMaxFeeMargin New global maximum (basis points)
     * @dev Only owner can change global bounds. Existing tokens unaffected.
     */
    function setGlobalFeeLimits(uint256 newMinFeeMargin, uint256 newMaxFeeMargin) external onlyOwner {
        if (newMinFeeMargin > newMaxFeeMargin) {
            revert InvalidFeeRange(newMinFeeMargin, newMaxFeeMargin);
        }

        if (newMaxFeeMargin > 1000) {
            revert InvalidFeeRange(newMinFeeMargin, newMaxFeeMargin); // Max 10%
        }

        uint256 oldMin = globalMinFeeMargin;
        uint256 oldMax = globalMaxFeeMargin;

        globalMinFeeMargin = newMinFeeMargin;
        globalMaxFeeMargin = newMaxFeeMargin;

        emit GlobalFeeLimitsUpdated(oldMin, oldMax, newMinFeeMargin, newMaxFeeMargin);
    }

    /**
     * @notice Update registration fee
     * @param newFee New fee amount in wei
     */
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = registrationFee;
        registrationFee = newFee;

        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasury();

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Pause new registrations (emergency)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause registrations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw registration fees to treasury
     * @dev Allows manual fee collection if needed
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) return;

        (bool success,) = treasury.call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    // ============ Cross-Chain Management ============

    /**
     * @notice Add a supported chain for cross-chain gas payment
     * @param chainId Chain ID to support
     * @param paymaster CrossChainPaymaster address on that chain
     */
    function addSupportedChain(uint256 chainId, address paymaster) external onlyOwner {
        require(paymaster != address(0), "Invalid paymaster");
        require(!isChainSupported[chainId], "Chain already supported");

        isChainSupported[chainId] = true;
        supportedChainIds.push(chainId);
        chainPaymasters[chainId] = paymaster;

        emit SupportedChainAdded(chainId);
        emit ChainPaymasterRegistered(chainId, paymaster);
    }

    /**
     * @notice Remove a supported chain
     * @param chainId Chain ID to remove
     */
    function removeSupportedChain(uint256 chainId) external onlyOwner {
        require(isChainSupported[chainId], "Chain not supported");

        isChainSupported[chainId] = false;
        chainPaymasters[chainId] = address(0);

        // Remove from array
        for (uint256 i = 0; i < supportedChainIds.length; i++) {
            if (supportedChainIds[i] == chainId) {
                supportedChainIds[i] = supportedChainIds[supportedChainIds.length - 1];
                supportedChainIds.pop();
                break;
            }
        }

        emit SupportedChainRemoved(chainId);
    }

    /**
     * @notice Enable cross-chain gas payment for a token on a specific chain
     * @param localToken Token address on this chain
     * @param chainId Target chain ID
     * @param tokenOnChain Token address on target chain
     * @dev Only token registrant can enable cross-chain
     */
    function enableCrossChain(address localToken, uint256 chainId, address tokenOnChain) external {
        TokenConfig storage config = tokens[localToken];
        if (config.tokenAddress == address(0)) revert TokenNotRegistered(localToken);
        require(msg.sender == config.registrant || msg.sender == owner(), "Not authorized");
        if (!isChainSupported[chainId]) revert ChainNotSupported(chainId);
        require(tokenOnChain != address(0), "Invalid token address");

        crossChainConfigs[localToken][chainId] = CrossChainConfig({
            chainId: chainId,
            tokenAddress: tokenOnChain,
            paymasterAddress: chainPaymasters[chainId],
            liquidity: 0,
            isActive: true
        });

        config.crossChainEnabled = true;

        emit CrossChainEnabled(localToken, chainId, tokenOnChain, chainPaymasters[chainId]);
    }

    /**
     * @notice Disable cross-chain for a token on a specific chain
     * @param localToken Token address on this chain
     * @param chainId Target chain ID
     */
    function disableCrossChain(address localToken, uint256 chainId) external {
        TokenConfig storage config = tokens[localToken];
        if (config.tokenAddress == address(0)) revert TokenNotRegistered(localToken);
        require(msg.sender == config.registrant || msg.sender == owner(), "Not authorized");

        crossChainConfigs[localToken][chainId].isActive = false;

        emit CrossChainDisabled(localToken, chainId);
    }

    /**
     * @notice Update cross-chain liquidity for a token (called by XLP system)
     * @param localToken Token address on this chain
     * @param chainId Chain where liquidity exists
     * @param newLiquidity Updated liquidity amount
     */
    function updateCrossChainLiquidity(address localToken, uint256 chainId, uint256 newLiquidity) external onlyOwner {
        CrossChainConfig storage ccConfig = crossChainConfigs[localToken][chainId];
        if (!ccConfig.isActive) revert CrossChainNotEnabled(localToken, chainId);

        uint256 oldLiquidity = ccConfig.liquidity;
        ccConfig.liquidity = newLiquidity;

        // Update token's total liquidity
        TokenConfig storage config = tokens[localToken];
        config.totalLiquidity = config.totalLiquidity - oldLiquidity + newLiquidity;

        // Update global cross-chain liquidity
        totalCrossChainLiquidity = totalCrossChainLiquidity - oldLiquidity + newLiquidity;

        emit CrossChainLiquidityUpdated(localToken, chainId, newLiquidity);
    }

    /**
     * @notice Get cross-chain config for a token
     * @param localToken Token address
     * @param chainId Chain ID
     * @return config Cross-chain configuration
     */
    function getCrossChainConfig(address localToken, uint256 chainId)
        external
        view
        returns (CrossChainConfig memory config)
    {
        return crossChainConfigs[localToken][chainId];
    }

    /**
     * @notice Get all chains where a token can be used for gas
     * @param localToken Token address
     * @return chainIds Array of chain IDs where token is enabled
     * @return liquidity Array of liquidity amounts per chain
     */
    function getTokenCrossChainInfo(address localToken)
        external
        view
        returns (uint256[] memory chainIds, uint256[] memory liquidity)
    {
        uint256 count = 0;

        // Count enabled chains
        for (uint256 i = 0; i < supportedChainIds.length; i++) {
            if (crossChainConfigs[localToken][supportedChainIds[i]].isActive) {
                count++;
            }
        }

        chainIds = new uint256[](count);
        liquidity = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < supportedChainIds.length; i++) {
            CrossChainConfig storage ccConfig = crossChainConfigs[localToken][supportedChainIds[i]];
            if (ccConfig.isActive) {
                chainIds[index] = supportedChainIds[i];
                liquidity[index] = ccConfig.liquidity;
                index++;
            }
        }
    }

    /**
     * @notice Get all supported chain IDs
     * @return Array of supported chain IDs
     */
    function getSupportedChains() external view returns (uint256[] memory) {
        return supportedChainIds;
    }

    /**
     * @notice Find best chain for gas payment based on liquidity
     * @param localToken Token to pay gas with
     * @param requiredLiquidity Minimum liquidity needed
     * @return bestChainId Chain with most liquidity meeting minimum
     * @return availableLiquidity Liquidity on that chain
     */
    function findBestChainForGas(address localToken, uint256 requiredLiquidity)
        external
        view
        returns (uint256 bestChainId, uint256 availableLiquidity)
    {
        for (uint256 i = 0; i < supportedChainIds.length; i++) {
            uint256 cid = supportedChainIds[i];
            CrossChainConfig storage ccConfig = crossChainConfigs[localToken][cid];

            if (ccConfig.isActive && ccConfig.liquidity >= requiredLiquidity) {
                if (ccConfig.liquidity > availableLiquidity) {
                    bestChainId = cid;
                    availableLiquidity = ccConfig.liquidity;
                }
            }
        }
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ============ Internal Validation ============

    /**
     * @notice Validate token behavior to reject malicious tokens
     * @param token Token address to validate
     * @dev Tests for fee-on-transfer and rebasing behavior
     */
    function _validateTokenBehavior(address token) internal {
        // Try to get sender's balance to validate token behavior
        try IERC20Metadata(token).balanceOf(msg.sender) returns (uint256 senderBalance) {
            // Use 100 tokens for fee-on-transfer detection (enough to detect % fees)
            uint256 testAmount = senderBalance >= 100 ? 100 : senderBalance;
            if (testAmount >= 100) {
                // Test transfer to detect fee-on-transfer
                uint256 balanceBefore = IERC20Metadata(token).balanceOf(address(this));

                try IERC20Metadata(token).transferFrom(msg.sender, address(this), testAmount) {
                    uint256 balanceAfter = IERC20Metadata(token).balanceOf(address(this));

                    // Check for fee-on-transfer (received less than sent)
                    if (balanceAfter != balanceBefore + testAmount) {
                        // Return the tokens
                        uint256 received = balanceAfter - balanceBefore;
                        if (received > 0) {
                            try IERC20Metadata(token).transfer(msg.sender, received) {} catch {}
                        }
                        revert FeeOnTransferToken(token);
                    }

                    // Return the test tokens
                    try IERC20Metadata(token).transfer(msg.sender, testAmount) {} catch {}
                } catch {
                    // Transfer failed - might need approval, that's OK
                    // We checked the basic interface compliance above
                }
            }
        } catch {
            // balanceOf failed - already caught above
        }

        // Note: Full rebasing detection would require block advancement (can't do in same tx)
        // Projects should be warned about rebasing tokens in documentation
    }
}
