// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/mocks/TestERC20.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "../src/council/Council.sol";
import "../src/council/CEOAgent.sol";

/**
 * @title DeployDAO
 * @notice Deploys full DAO stack for Council governance
 * @dev Run with: forge script script/DeployDAO.s.sol --rpc-url http://localhost:9545 --broadcast
 */
contract DeployDAO is Script {
    function run() external {
        // Use the default anvil private key
        uint256 deployerKey = vm.envOr("DEPLOYER_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);
        
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        
        vm.startBroadcast(deployerKey);
        
        // 1. Deploy Governance Token
        TestERC20 token = new TestERC20("Jeju Governance", "JEJU", 1_000_000_000 ether);
        console.log("GovernanceToken:", address(token));
        
        // 2. Deploy Identity Registry
        IdentityRegistry identity = new IdentityRegistry();
        console.log("IdentityRegistry:", address(identity));
        
        // 3. Deploy Reputation Registry
        ReputationRegistry reputation = new ReputationRegistry(payable(address(identity)));
        console.log("ReputationRegistry:", address(reputation));
        
        // 4. Deploy Council
        Council council = new Council(
            address(token),
            address(identity),
            address(reputation),
            deployer
        );
        console.log("Council:", address(council));
        
        // 5. Deploy CEO Agent
        CEOAgent ceo = new CEOAgent(
            address(token),
            address(council),
            "claude-opus-4-5-20250514",
            deployer
        );
        console.log("CEOAgent:", address(ceo));
        
        // 6. Configure Council with CEO
        council.setCEOAgent(address(ceo), 1);
        console.log("CEO configured");
        
        // 7. Set research operator
        council.setResearchOperator(deployer, true);
        console.log("Research operator set");
        
        // 8. Register deployer as first council agent (for testing)
        // In production, each agent would have separate addresses
        identity.register("ipfs://deployer-agent");
        
        // Set deployer as all council agents for simplicity (testing only)
        council.setCouncilAgent(Council.CouncilRole.TREASURY, deployer, 1, 100);
        council.setCouncilAgent(Council.CouncilRole.CODE, deployer, 1, 100);
        council.setCouncilAgent(Council.CouncilRole.COMMUNITY, deployer, 1, 100);
        council.setCouncilAgent(Council.CouncilRole.SECURITY, deployer, 1, 100);
        console.log("Council agents configured");
        
        vm.stopBroadcast();
        
        // Output JSON for easy parsing
        string memory json = string(abi.encodePacked(
            '{"GovernanceToken":"', vm.toString(address(token)),
            '","IdentityRegistry":"', vm.toString(address(identity)),
            '","ReputationRegistry":"', vm.toString(address(reputation)),
            '","Council":"', vm.toString(address(council)),
            '","CEOAgent":"', vm.toString(address(ceo)),
            '","deployer":"', vm.toString(deployer),
            '"}'
        ));
        console.log("\nDeployment JSON:");
        console.log(json);
    }
}
