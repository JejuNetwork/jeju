// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IBanManager {
    function isAddressBanned(address target) external view returns (bool);
    function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool);
}

contract JejuToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18;
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10 ** 18;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    bytes32 public constant JEJU_APP_ID = keccak256("jeju.network");

    IBanManager public banManager;
    bool public banEnforcementEnabled;
    bool public faucetEnabled;
    mapping(address => uint256) public lastFaucetClaim;
    
    mapping(address => bool) public banExempt;

    event BanManagerUpdated(address indexed oldManager, address indexed newManager);
    event BanEnforcementToggled(bool enabled);
    event FaucetToggled(bool enabled);
    event FaucetClaimed(address indexed claimer, uint256 amount);
    event BanExemptUpdated(address indexed account, bool exempt);

    error BannedUser(address user);
    error MaxSupplyExceeded();
    error FaucetDisabled();
    error FaucetCooldownActive(uint256 nextClaimTime);
    error FaucetInsufficientBalance();

    constructor(
        address initialOwner,
        address _banManager,
        bool enableFaucet
    ) ERC20("Jeju", "JEJU") Ownable(initialOwner) {
        _mint(initialOwner, INITIAL_SUPPLY);
        if (_banManager != address(0)) {
            banManager = IBanManager(_banManager);
            banEnforcementEnabled = true;
        }
        faucetEnabled = enableFaucet;
    }

    function isBanned(address account) public view returns (bool) {
        if (!banEnforcementEnabled || address(banManager) == address(0)) {
            return false;
        }
        return banManager.isAddressBanned(account);
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        if (banEnforcementEnabled && address(banManager) != address(0)) {
            bool toExempt = banExempt[to];
            if (from != address(0) && !toExempt && banManager.isAddressBanned(from)) {
                revert BannedUser(from);
            }
            if (to != address(0) && banManager.isAddressBanned(to)) {
                revert BannedUser(to);
            }
        }
        super._update(from, to, value);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    function faucet() external {
        if (!faucetEnabled) revert FaucetDisabled();
        uint256 nextClaim = lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN;
        if (block.timestamp < nextClaim) revert FaucetCooldownActive(nextClaim);
        if (balanceOf(owner()) < FAUCET_AMOUNT) revert FaucetInsufficientBalance();
        lastFaucetClaim[msg.sender] = block.timestamp;
        _transfer(owner(), msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    function faucetTo(address recipient) external {
        if (!faucetEnabled) revert FaucetDisabled();
        uint256 nextClaim = lastFaucetClaim[recipient] + FAUCET_COOLDOWN;
        if (block.timestamp < nextClaim) revert FaucetCooldownActive(nextClaim);
        if (balanceOf(owner()) < FAUCET_AMOUNT) revert FaucetInsufficientBalance();
        lastFaucetClaim[recipient] = block.timestamp;
        _transfer(owner(), recipient, FAUCET_AMOUNT);
        emit FaucetClaimed(recipient, FAUCET_AMOUNT);
    }

    function setBanManager(address _banManager) external onlyOwner {
        address oldManager = address(banManager);
        banManager = IBanManager(_banManager);
        emit BanManagerUpdated(oldManager, _banManager);
    }

    function setBanEnforcement(bool enabled) external onlyOwner {
        banEnforcementEnabled = enabled;
        emit BanEnforcementToggled(enabled);
    }

    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
        emit FaucetToggled(enabled);
    }

    function setBanExempt(address account, bool exempt) external onlyOwner {
        banExempt[account] = exempt;
        emit BanExemptUpdated(account, exempt);
    }

    function faucetCooldownRemaining(address account) external view returns (uint256) {
        uint256 nextClaim = lastFaucetClaim[account] + FAUCET_COOLDOWN;
        if (block.timestamp >= nextClaim) return 0;
        return nextClaim - block.timestamp;
    }

    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}
