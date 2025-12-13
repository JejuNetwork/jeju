// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {SponsoredPaymaster} from "../src/paymaster/SponsoredPaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title Deploy SponsoredPaymaster
 * @notice Deploys and configures the SponsoredPaymaster for gasless transactions
 *
 * Prerequisites:
 *   - EntryPoint must be deployed at 0x0000000071727De22E5E9d8BAf0edAc6f37da032
 *   - For local testing, first deploy MockEntryPoint using DeployMockEntryPoint
 *
 * Usage:
 *   forge script script/DeploySponsoredPaymaster.s.sol:DeploySponsoredPaymaster \
 *     --rpc-url http://localhost:8545 --broadcast -vvvv
 */
contract DeploySponsoredPaymaster is Script {
    // EntryPoint v0.7 canonical address
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        // Check EntryPoint exists
        require(ENTRYPOINT_V07.code.length > 0, "EntryPoint not deployed. Run DeployMockEntryPoint first.");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy SponsoredPaymaster
        console.log("Deploying SponsoredPaymaster...");
        SponsoredPaymaster paymaster = new SponsoredPaymaster(IEntryPoint(ENTRYPOINT_V07), deployer);
        console.log("SponsoredPaymaster deployed at:", address(paymaster));

        // Fund the paymaster with 10 ETH
        console.log("Funding paymaster with 10 ETH...");
        paymaster.fund{value: 10 ether}();

        // Whitelist all contracts (address(0) = sponsor everything)
        console.log("Whitelisting all contracts...");
        paymaster.setWhitelistedTarget(address(0), true);

        // Verify configuration
        (uint256 deposit, bool isPaused,,) = paymaster.getStatus();
        console.log("Paymaster deposit:", deposit);
        console.log("Paymaster paused:", isPaused);
        console.log("All targets whitelisted:", paymaster.isWhitelisted(address(0)));

        vm.stopBroadcast();

        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("SponsoredPaymaster:", address(paymaster));
        console.log("EntryPoint:", ENTRYPOINT_V07);
        console.log("Owner:", deployer);
        console.log("Deposit:", deposit, "wei");
    }
}

/**
 * @title Deploy Mock EntryPoint
 * @notice Deploys MockEntryPoint to canonical address for local testing
 *
 * Usage:
 *   forge script script/DeploySponsoredPaymaster.s.sol:DeployMockEntryPoint \
 *     --rpc-url http://localhost:8545 --broadcast
 */
contract DeployMockEntryPoint is Script {
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock
        MockEntryPoint mock = new MockEntryPoint();
        console.log("MockEntryPoint deployed at:", address(mock));

        vm.stopBroadcast();

        // Etch the code to canonical address (requires foundry cheatcode access)
        vm.etch(ENTRYPOINT_V07, address(mock).code);
        console.log("Code etched to:", ENTRYPOINT_V07);
    }
}

/**
 * @title Mock EntryPoint
 * @notice Minimal EntryPoint mock for local testing
 */
contract MockEntryPoint {
    mapping(address => uint256) public deposits;
    mapping(address => mapping(uint192 => uint256)) public nonceSequenceNumber;

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool success,) = withdrawAddress.call{value: amount}("");
        require(success, "Withdraw failed");
    }

    function addStake(uint32) external payable {
        deposits[msg.sender] += msg.value;
    }

    function unlockStake() external {}

    function withdrawStake(address payable withdrawAddress) external {
        uint256 stake = deposits[msg.sender];
        deposits[msg.sender] = 0;
        (bool success,) = withdrawAddress.call{value: stake}("");
        require(success, "Withdraw failed");
    }

    function getNonce(address sender, uint192 key) external view returns (uint256) {
        return nonceSequenceNumber[sender][key] | (uint256(key) << 64);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x283f5489 || interfaceId == 0x01ffc9a7;
    }

    receive() external payable {}
}
