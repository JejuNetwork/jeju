// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LaunchpadToken
 * @author Jeju Network
 * @notice ERC20 token created by TokenLaunchpad
 * @dev Simple ERC20 with fixed supply, minted entirely to initial holder
 */
contract LaunchpadToken is ERC20, Ownable {
    uint8 private constant DECIMALS = 18;

    /// @notice Address of the launchpad that created this token
    address public immutable launchpad;

    /// @notice Creator of the token
    address public immutable creator;

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address initialHolder_)
        ERC20(name_, symbol_)
        Ownable(initialHolder_)
    {
        launchpad = msg.sender;
        creator = tx.origin;
        _mint(initialHolder_, totalSupply_);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
}
