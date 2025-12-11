// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Gold
 * @author Jeju Network
 * @notice In-game gold token for any Jeju-based game
 * @dev Standard ERC-20 token that:
 *      - Can be earned in-game and claimed via signature
 *      - Can be spent in game for items/upgrades
 *      - Can be traded on marketplace (Bazaar)
 *      - Integrates with PlayerTradeEscrow for P2P trading
 *      - No special treatment - equal to other game tokens
 *
 * Game Integration:
 * - Players earn gold by killing mobs, completing quests, selling items
 * - Game server signs claim requests with (player, amount, nonce)
 * - Players call claimGold() with signature to mint tokens
 * - Prevents double-claims via nonce tracking
 * - Gold spent in-game is burned
 *
 * Security Features:
 * - Signature-based minting (only game server can authorize)
 * - Nonce prevents replay attacks
 * - Unlimited supply (in-game economy determines scarcity)
 * - Burnable for in-game purchases
 *
 * @custom:security-contact security@jeju.network
 */
contract Gold is ERC20, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ State Variables ============

    /// @notice Game's agent ID in IdentityRegistry (ERC-8004)
    /// @dev Links this currency to a registered game entity
    uint256 public immutable gameAgentId;

    /// @notice Address authorized to sign gold claims (game server)
    address public gameSigner;

    /// @notice Nonce per player to prevent replay attacks
    mapping(address => uint256) public nonces;

    // ============ Events ============

    event GoldClaimed(address indexed player, uint256 amount, uint256 nonce);
    event GoldBurned(address indexed player, uint256 amount);
    event GameSignerUpdated(address indexed oldSigner, address indexed newSigner);

    // ============ Errors ============

    error InvalidSignature();
    error InvalidNonce();
    error InvalidAmount();
    error InvalidGameSigner();

    // ============ Constructor ============

    /**
     * @notice Deploy Gold token
     * @param _name Token name (e.g., "Hyperscape Gold", "MyGame Gold")
     * @param _symbol Token symbol (e.g., "HG", "MG")
     * @param _gameAgentId Game's agent ID in IdentityRegistry (ERC-8004)
     * @param _gameSigner Address authorized to sign gold claims
     * @param _owner Contract owner (admin)
     * @dev Game must be registered in IdentityRegistry before deployment
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _gameAgentId,
        address _gameSigner,
        address _owner
    )
        ERC20(_name, _symbol)
        Ownable(_owner)
    {
        if (_gameSigner == address(0)) revert InvalidGameSigner();
        gameAgentId = _gameAgentId;
        gameSigner = _gameSigner;
    }

    // ============ Player Functions ============

    /**
     * @notice Claim gold earned in-game
     * @param amount Amount of gold to claim
     * @param nonce Unique nonce for this claim (must be current nonce)
     * @param signature Signature from game server authorizing claim
     * @dev Signature = sign(keccak256(abi.encodePacked(player, amount, nonce)))
     */
    function claimGold(uint256 amount, uint256 nonce, bytes memory signature) external {
        if (amount == 0) revert InvalidAmount();
        if (nonce != nonces[msg.sender]) revert InvalidNonce();

        if (!verifyClaim(msg.sender, amount, nonce, signature)) {
            revert InvalidSignature();
        }

        nonces[msg.sender]++;
        _mint(msg.sender, amount);

        emit GoldClaimed(msg.sender, amount, nonce);
    }

    /**
     * @notice Burn gold for in-game purchases
     * @param amount Amount of gold to burn
     * @dev Anyone can burn their own gold
     */
    function burn(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _burn(msg.sender, amount);
        emit GoldBurned(msg.sender, amount);
    }

    /**
     * @notice Burn gold from another address (requires approval)
     * @param from Address to burn from
     * @param amount Amount to burn
     * @dev Used by game contracts to deduct gold for purchases
     */
    function burnFrom(address from, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit GoldBurned(from, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get next nonce for a player
     * @param player Player address
     * @return Next valid nonce
     */
    function getNonce(address player) external view returns (uint256) {
        return nonces[player];
    }

    /**
     * @notice Verify a gold claim signature
     * @param player Player address
     * @param amount Amount of gold
     * @param nonce Nonce for this claim
     * @param signature Signature to verify
     * @return True if signature is valid
     */
    function verifyClaim(address player, uint256 amount, uint256 nonce, bytes memory signature)
        public
        view
        returns (bool)
    {
        bytes32 messageHash = keccak256(abi.encodePacked(player, amount, nonce));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        return signer == gameSigner;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update game signer address
     * @param newSigner New game signer address
     * @dev Only owner can update
     */
    function setGameSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidGameSigner();
        address oldSigner = gameSigner;
        gameSigner = newSigner;
        emit GameSignerUpdated(oldSigner, newSigner);
    }

    /**
     * @notice Emergency mint (testing only, remove for production)
     * @param to Address to mint to
     * @param amount Amount to mint
     * @dev Only owner, should be removed or heavily restricted in production
     */
    function emergencyMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Get contract version
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
