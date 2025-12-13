// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MessageNodeRegistry} from "../src/messaging/MessageNodeRegistry.sol";
import {KeyRegistry} from "../src/messaging/KeyRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployMessaging
 * @notice Deploy Jeju Messaging contracts
 *
 * Usage:
 *   forge script script/DeployMessaging.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - STAKING_TOKEN: Address of staking token (or deploys mock if not set)
 */
contract DeployMessaging is Script {
    // Deployed addresses
    MessageNodeRegistry public nodeRegistry;
    KeyRegistry public keyRegistry;
    address public stakingToken;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== Jeju Messaging Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Get or deploy staking token
        stakingToken = vm.envOr("STAKING_TOKEN", address(0));
        if (stakingToken == address(0)) {
            console.log("\nDeploying Mock Staking Token...");
            stakingToken = deployMockToken();
            console.log("Mock Token deployed:", stakingToken);
        } else {
            console.log("\nUsing existing staking token:", stakingToken);
        }

        // 2. Deploy KeyRegistry
        console.log("\nDeploying KeyRegistry...");
        keyRegistry = new KeyRegistry();
        console.log("KeyRegistry deployed:", address(keyRegistry));

        // 3. Deploy MessageNodeRegistry
        console.log("\nDeploying MessageNodeRegistry...");
        nodeRegistry = new MessageNodeRegistry(stakingToken, deployer);
        console.log("MessageNodeRegistry deployed:", address(nodeRegistry));

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("KeyRegistry:", address(keyRegistry));
        console.log("MessageNodeRegistry:", address(nodeRegistry));
        console.log("StakingToken:", stakingToken);

        // Write to JSON file
        string memory json = string(
            abi.encodePacked(
                '{"keyRegistry":"',
                vm.toString(address(keyRegistry)),
                '","nodeRegistry":"',
                vm.toString(address(nodeRegistry)),
                '","stakingToken":"',
                vm.toString(stakingToken),
                '","chainId":',
                vm.toString(block.chainid),
                ',"deployer":"',
                vm.toString(deployer),
                '"}'
            )
        );

        string memory path = string(abi.encodePacked("deployments/messaging-", vm.toString(block.chainid), ".json"));
        vm.writeFile(path, json);
        console.log("\nDeployment saved to:", path);
    }

    function deployMockToken() internal returns (address) {
        // Deploy a simple ERC20 for testing
        MockJEJU token = new MockJEJU();
        return address(token);
    }
}

/**
 * @title MockJEJU
 * @notice Simple ERC20 for testing messaging staking
 */
contract MockJEJU is IERC20 {
    string public constant name = "Mock JEJU";
    string public constant symbol = "mJEJU";
    uint8 public constant decimals = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    constructor() {
        // Mint 1M tokens to deployer
        _mint(msg.sender, 1_000_000 ether);
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        _allowances[from][msg.sender] = currentAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "Insufficient balance");
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
