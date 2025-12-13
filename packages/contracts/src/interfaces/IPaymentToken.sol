// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IPaymentToken
 * @notice ERC-20 with optional minting. Implemented by ElizaOSToken.
 */
interface IPaymentToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function version() external view returns (string memory);
}
