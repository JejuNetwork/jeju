// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleERC20
 * @notice Basic ERC20 token deployed via factory
 */
contract SimpleERC20 is ERC20, Ownable {
    uint8 private immutable _decimals;
    address public immutable factory;
    address public immutable creator;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 initialSupply_, address creator_)
        ERC20(name_, symbol_)
        Ownable(creator_)
    {
        _decimals = decimals_;
        factory = msg.sender;
        creator = creator_;

        if (initialSupply_ > 0) {
            _mint(creator_, initialSupply_);
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

/**
 * @title SimpleERC20Factory
 * @notice Factory contract for deploying ERC20 tokens
 * @dev Used by Bazaar to enable one-click token creation
 */
contract SimpleERC20Factory {
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint8 decimals,
        uint256 initialSupply
    );

    mapping(address => address[]) public creatorTokens;
    address[] public allTokens;

    /**
     * @notice Create a new ERC20 token
     * @param name Token name
     * @param symbol Token symbol (max 10 characters)
     * @param decimals Token decimals (typically 18)
     * @param initialSupply Initial supply to mint to creator
     * @return token Address of newly created token
     */
    function createToken(string memory name, string memory symbol, uint8 decimals, uint256 initialSupply)
        external
        returns (address token)
    {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 10, "Invalid symbol");
        require(decimals <= 18, "Decimals too high");

        SimpleERC20 newToken = new SimpleERC20(name, symbol, decimals, initialSupply, msg.sender);

        token = address(newToken);

        creatorTokens[msg.sender].push(token);
        allTokens.push(token);

        emit TokenCreated(token, msg.sender, name, symbol, decimals, initialSupply);
    }

    /**
     * @notice Get all tokens created by an address
     */
    function getCreatorTokens(address creator) external view returns (address[] memory) {
        return creatorTokens[creator];
    }

    /**
     * @notice Get total number of tokens created
     */
    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    /**
     * @notice Get all created tokens (paginated)
     */
    function getAllTokens(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = allTokens.length;
        if (offset >= total) {
            return new address[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        address[] memory result = new address[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = allTokens[offset + i];
        }

        return result;
    }
}
