// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title AppTokenPreference
 * @author Jeju Network
 * @notice Registry for app-level token preferences for payments and gas
 * @dev Apps can specify their preferred token (e.g., Hyperscape prefers HYPER)
 *      Users who have the preferred token will use it first for gas/payment.
 *      If user doesn't have it, falls back to next best XLP-supported token.
 *
 * Flow:
 * 1. App registers with preferred token (must have XLP liquidity)
 * 2. User interacts with app
 * 3. System checks: Does user have app's preferred token?
 *    - YES: Use that token for gas/payment
 *    - NO: Fall back to best available token in user's wallet
 * 4. XLP handles the conversion regardless of token chosen
 *
 * Benefits:
 * - Apps can drive adoption of their token
 * - Users get seamless experience (no bridging, no gas management)
 * - XLPs earn fees on all token conversions
 * - Everyone wins
 *
 * @custom:security-contact security@jeju.network
 */
contract AppTokenPreference is Ownable {
    // ============ Structs ============

    struct AppPreference {
        address appAddress; // App contract or identifier
        address preferredToken; // Token app prefers for payments
        string tokenSymbol; // Cached for display
        uint8 tokenDecimals; // Cached for conversions
        bool allowFallback; // Allow other tokens if user doesn't have preferred
        uint256 minBalance; // Minimum balance to consider "has token"
        bool isActive; // Whether preference is active
        address registrant; // Who registered this app
        uint256 registrationTime;
    }

    struct TokenPriority {
        address token;
        uint256 priority; // Lower = higher priority
    }

    // ============ State Variables ============

    /// @notice App preferences: appAddress => AppPreference
    mapping(address => AppPreference) public appPreferences;

    /// @notice Fallback token priorities for an app: appAddress => token[]
    mapping(address => address[]) public appFallbackTokens;

    /// @notice Global default tokens when no app preference (ordered by priority)
    address[] public globalDefaultTokens;

    /// @notice All registered apps
    address[] public registeredApps;

    /// @notice Token Registry for validating XLP support
    address public tokenRegistry;

    /// @notice CrossChainPaymaster for checking liquidity
    address public crossChainPaymaster;

    // ============ Events ============

    event AppPreferenceSet(
        address indexed appAddress,
        address indexed preferredToken,
        string symbol,
        bool allowFallback,
        address registrant
    );

    event AppPreferenceUpdated(address indexed appAddress, address indexed newPreferredToken, string symbol);

    event AppPreferenceRemoved(address indexed appAddress);

    event FallbackTokensSet(address indexed appAddress, address[] tokens);

    event GlobalDefaultsSet(address[] tokens);

    event TokenRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    event CrossChainPaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);

    // ============ Errors ============

    error AppAlreadyRegistered(address app);
    error AppNotRegistered(address app);
    error InvalidToken(address token);
    error TokenNotSupported(address token);
    error NotAuthorized();
    error InvalidAddress();

    // ============ Constructor ============

    constructor(address _tokenRegistry, address _crossChainPaymaster, address initialOwner) Ownable(initialOwner) {
        require(_tokenRegistry != address(0), "Invalid registry");
        tokenRegistry = _tokenRegistry;
        crossChainPaymaster = _crossChainPaymaster;
    }

    // ============ App Registration ============

    /**
     * @notice Register an app with its preferred payment token
     * @param appAddress The app's contract address or identifier
     * @param preferredToken Token the app prefers for payments
     * @param allowFallback Whether to allow other tokens if user doesn't have preferred
     * @param minBalance Minimum balance to consider user "has" the token
     */
    function registerApp(address appAddress, address preferredToken, bool allowFallback, uint256 minBalance)
        external
    {
        if (appAddress == address(0)) revert InvalidAddress();
        if (appPreferences[appAddress].isActive) revert AppAlreadyRegistered(appAddress);
        if (preferredToken == address(0)) revert InvalidToken(preferredToken);

        // Get token metadata
        string memory symbol = "";
        uint8 decimals = 18;

        if (preferredToken != address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            symbol = IERC20Metadata(preferredToken).symbol();
            decimals = IERC20Metadata(preferredToken).decimals();
        } else {
            symbol = "ETH";
        }

        appPreferences[appAddress] = AppPreference({
            appAddress: appAddress,
            preferredToken: preferredToken,
            tokenSymbol: symbol,
            tokenDecimals: decimals,
            allowFallback: allowFallback,
            minBalance: minBalance,
            isActive: true,
            registrant: msg.sender,
            registrationTime: block.timestamp
        });

        registeredApps.push(appAddress);

        emit AppPreferenceSet(appAddress, preferredToken, symbol, allowFallback, msg.sender);
    }

    /**
     * @notice Update an app's preferred token
     * @param appAddress The app's address
     * @param newPreferredToken New preferred token
     */
    function updatePreferredToken(address appAddress, address newPreferredToken) external {
        AppPreference storage pref = appPreferences[appAddress];
        if (!pref.isActive) revert AppNotRegistered(appAddress);
        if (msg.sender != pref.registrant && msg.sender != owner()) revert NotAuthorized();
        if (newPreferredToken == address(0)) revert InvalidToken(newPreferredToken);

        string memory symbol = "";
        uint8 decimals = 18;

        if (newPreferredToken != address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            symbol = IERC20Metadata(newPreferredToken).symbol();
            decimals = IERC20Metadata(newPreferredToken).decimals();
        } else {
            symbol = "ETH";
        }

        pref.preferredToken = newPreferredToken;
        pref.tokenSymbol = symbol;
        pref.tokenDecimals = decimals;

        emit AppPreferenceUpdated(appAddress, newPreferredToken, symbol);
    }

    /**
     * @notice Set fallback tokens for an app (ordered by priority)
     * @param appAddress The app's address
     * @param tokens Array of fallback tokens in priority order
     */
    function setFallbackTokens(address appAddress, address[] calldata tokens) external {
        AppPreference storage pref = appPreferences[appAddress];
        if (!pref.isActive) revert AppNotRegistered(appAddress);
        if (msg.sender != pref.registrant && msg.sender != owner()) revert NotAuthorized();

        delete appFallbackTokens[appAddress];
        for (uint256 i = 0; i < tokens.length; i++) {
            appFallbackTokens[appAddress].push(tokens[i]);
        }

        emit FallbackTokensSet(appAddress, tokens);
    }

    /**
     * @notice Remove an app's preference
     * @param appAddress The app's address
     */
    function removeApp(address appAddress) external {
        AppPreference storage pref = appPreferences[appAddress];
        if (!pref.isActive) revert AppNotRegistered(appAddress);
        if (msg.sender != pref.registrant && msg.sender != owner()) revert NotAuthorized();

        pref.isActive = false;
        delete appFallbackTokens[appAddress];

        emit AppPreferenceRemoved(appAddress);
    }

    // ============ Token Selection Logic ============

    /**
     * @notice Get the best token for a user to pay with for a specific app
     * @param appAddress The app's address
     * @param userBalances Array of (token, balance) pairs for tokens user holds
     * @return bestToken Best token to use
     * @return reason Why this token was selected
     */
    function getBestPaymentToken(address appAddress, address /* user */, TokenBalance[] calldata userBalances)
        external
        view
        returns (address bestToken, string memory reason)
    {
        AppPreference storage pref = appPreferences[appAddress];

        // If app has preference and user has that token
        if (pref.isActive && pref.preferredToken != address(0)) {
            for (uint256 i = 0; i < userBalances.length; i++) {
                if (
                    userBalances[i].token == pref.preferredToken && userBalances[i].balance >= pref.minBalance
                ) {
                    return (pref.preferredToken, "App preferred token");
                }
            }

            // If no fallback allowed, return preferred token anyway (will fail if insufficient)
            if (!pref.allowFallback) {
                return (pref.preferredToken, "App requires this token");
            }
        }

        // Check app's fallback tokens
        if (pref.isActive) {
            address[] storage fallbacks = appFallbackTokens[appAddress];
            for (uint256 i = 0; i < fallbacks.length; i++) {
                for (uint256 j = 0; j < userBalances.length; j++) {
                    if (userBalances[j].token == fallbacks[i] && userBalances[j].balance > 0) {
                        return (fallbacks[i], "App fallback token");
                    }
                }
            }
        }

        // Fall back to global defaults
        for (uint256 i = 0; i < globalDefaultTokens.length; i++) {
            for (uint256 j = 0; j < userBalances.length; j++) {
                if (userBalances[j].token == globalDefaultTokens[i] && userBalances[j].balance > 0) {
                    return (globalDefaultTokens[i], "Global default token");
                }
            }
        }

        // Return first token with balance
        for (uint256 i = 0; i < userBalances.length; i++) {
            if (userBalances[i].balance > 0) {
                return (userBalances[i].token, "First available token");
            }
        }

        return (address(0), "No suitable token found");
    }

    /**
     * @notice Check if user has app's preferred token with sufficient balance
     * @param appAddress The app's address
     * @param user User's address (unused in pure check, for interface)
     * @param token Token to check
     * @param balance User's balance of that token
     * @return hasPreferred Whether user has the preferred token
     */
    function hasPreferredToken(address appAddress, address user, address token, uint256 balance)
        external
        view
        returns (bool hasPreferred)
    {
        // Silence unused variable warning
        user;
        
        AppPreference storage pref = appPreferences[appAddress];
        if (!pref.isActive) return false;
        return token == pref.preferredToken && balance >= pref.minBalance;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set global default tokens (used when no app preference)
     * @param tokens Array of tokens in priority order
     */
    function setGlobalDefaults(address[] calldata tokens) external onlyOwner {
        delete globalDefaultTokens;
        for (uint256 i = 0; i < tokens.length; i++) {
            globalDefaultTokens.push(tokens[i]);
        }
        emit GlobalDefaultsSet(tokens);
    }

    /**
     * @notice Update token registry address
     * @param _tokenRegistry New registry address
     */
    function setTokenRegistry(address _tokenRegistry) external onlyOwner {
        require(_tokenRegistry != address(0), "Invalid registry");
        address old = tokenRegistry;
        tokenRegistry = _tokenRegistry;
        emit TokenRegistryUpdated(old, _tokenRegistry);
    }

    /**
     * @notice Update cross-chain paymaster address
     * @param _crossChainPaymaster New paymaster address
     */
    function setCrossChainPaymaster(address _crossChainPaymaster) external onlyOwner {
        address old = crossChainPaymaster;
        crossChainPaymaster = _crossChainPaymaster;
        emit CrossChainPaymasterUpdated(old, _crossChainPaymaster);
    }

    // ============ View Functions ============

    /**
     * @notice Get app preference details
     * @param appAddress The app's address
     * @return preference Full preference details
     */
    function getAppPreference(address appAddress) external view returns (AppPreference memory preference) {
        return appPreferences[appAddress];
    }

    /**
     * @notice Get app's fallback tokens
     * @param appAddress The app's address
     * @return tokens Array of fallback tokens
     */
    function getAppFallbackTokens(address appAddress) external view returns (address[] memory tokens) {
        return appFallbackTokens[appAddress];
    }

    /**
     * @notice Get all registered apps
     * @return apps Array of app addresses
     */
    function getRegisteredApps() external view returns (address[] memory apps) {
        return registeredApps;
    }

    /**
     * @notice Get global default tokens
     * @return tokens Array of default tokens
     */
    function getGlobalDefaults() external view returns (address[] memory tokens) {
        return globalDefaultTokens;
    }

    /**
     * @notice Get count of registered apps
     * @return count Number of registered apps
     */
    function getAppCount() external view returns (uint256 count) {
        return registeredApps.length;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

// Helper struct for token balances
struct TokenBalance {
    address token;
    uint256 balance;
}
