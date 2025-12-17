// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BridgedBAT
 * @author Jeju Network
 * @notice Wrapped BAT token on Jeju L2, backed 1:1 by BAT locked on Ethereum
 * @dev Part of the Brave/BAT integration for Jeju Network
 *
 * ## How it works:
 * 1. User locks BAT on Ethereum via CrossChainPaymaster voucher system
 * 2. XLP fulfills the voucher by minting BridgedBAT on Jeju
 * 3. When user bridges back, BridgedBAT is burned and original BAT released
 *
 * ## Security:
 * - Only authorized bridge contracts can mint/burn
 * - Backed 1:1 by locked BAT on Ethereum L1
 * - XLP slashing ensures economic security
 *
 * @custom:security-contact security@jeju.network
 */
contract BridgedBAT is ERC20, ERC20Burnable, Ownable, Pausable {
    address public constant L1_BAT_ADDRESS = 0x0D8775F648430679A709E98d2b0Cb6250d2887EF;
    uint256 public constant MAX_SUPPLY = 1_500_000_000 * 1e18;
    mapping(address => bool) public minters;
    uint256 public totalBridged;
    uint256 public totalBridgedBack;

    event MinterUpdated(address indexed minter, bool authorized);
    event BridgedIn(address indexed recipient, uint256 amount, bytes32 indexed voucherId);
    event BridgedOut(address indexed sender, uint256 amount, address indexed l1Recipient);


    error NotAuthorizedMinter();
    error ExceedsMaxSupply();
    error ZeroAmount();
    error ZeroAddress();


    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotAuthorizedMinter();
        _;
    }

    // ============ Constructor ============

    constructor(address _owner) ERC20("Bridged Basic Attention Token", "BAT") Ownable(_owner) {}

    function mint(address to, uint256 amount) external onlyMinter whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();

        totalBridged += amount;
        _mint(to, amount);
    }

    function mintWithVoucher(address to, uint256 amount, bytes32 voucherId) external onlyMinter whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();

        totalBridged += amount;
        _mint(to, amount);

        emit BridgedIn(to, amount, voucherId);
    }

    function bridgeOut(uint256 amount, address l1Recipient) external whenNotPaused {
        if (l1Recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        totalBridgedBack += amount;
        _burn(msg.sender, amount);

        emit BridgedOut(msg.sender, amount, l1Recipient);
    }

    // ============ Admin ============

    /**
     * @notice Set minter authorization
     * @param minter Address to authorize/deauthorize
     * @param authorized Whether to authorize
     */
    function setMinter(address minter, bool authorized) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = authorized;
        emit MinterUpdated(minter, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getBridgeStats()
        external
        view
        returns (uint256 bridgedIn, uint256 bridgedOut, uint256 netBridged)
    {
        bridgedIn = totalBridged;
        bridgedOut = totalBridgedBack;
        netBridged = totalBridged - totalBridgedBack;
    }

    function isMinter(address account) external view returns (bool) {
        return minters[account];
    }

    function l1Token() external pure returns (address) {
        return L1_BAT_ADDRESS;
    }
}

