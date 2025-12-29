// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {DAORegistry} from "../src/governance/DAORegistry.sol";
import {DAOFunding} from "../src/governance/DAOFunding.sol";
import {FeeConfig} from "../src/distributor/FeeConfig.sol";
import {IDAORegistry} from "../src/governance/interfaces/IDAORegistry.sol";

/**
 * @title DeployDAORegistry
 * @notice Deploy multi-tenant DAO governance infrastructure
 *
 * Usage:
 *   forge script script/DeployDAORegistry.s.sol --rpc-url http://localhost:6546 --broadcast
 *   forge script script/DeployDAORegistry.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployDAORegistry is Script {
    DAORegistry public daoRegistry;
    DAOFunding public daoFunding;
    FeeConfig public feeConfig;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        // 1. Deploy FeeConfig (board, director, treasury, owner)
        // Initially set deployer as board/director, can be updated after DAORegistry is deployed
        feeConfig = new FeeConfig(deployer, deployer, deployer, deployer);
        console.log("FeeConfig deployed at:", address(feeConfig));

        // 2. Deploy DAORegistry
        daoRegistry = new DAORegistry(deployer);
        console.log("DAORegistry deployed at:", address(daoRegistry));

        // 3. Deploy DAOFunding (uses native ETH as funding token)
        daoFunding = new DAOFunding(
            address(daoRegistry),
            address(0), // ETH as funding token
            deployer
        );
        console.log("DAOFunding deployed at:", address(daoFunding));

        // 4. Create Jeju DAO
        string[] memory jejuTraits = new string[](4);
        jejuTraits[0] = "strategic";
        jejuTraits[1] = "analytical";
        jejuTraits[2] = "decisive";
        jejuTraits[3] = "transparent";

        IDAORegistry.DirectorPersona memory jejuDirector = IDAORegistry.DirectorPersona({
            name: "Jeju Director",
            pfpCid: "",
            description: "The governance leader of Jeju Network, responsible for chain-level decisions, treasury management, and network evolution.",
            personality: "Strategic, analytical, and forward-thinking. Balances innovation with stability.",
            traits: jejuTraits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 7
        });

        IDAORegistry.GovernanceParams memory jejuParams = IDAORegistry.GovernanceParams({
            minQualityScore: 70,
            boardVotingPeriod: 3 days,
            gracePeriod: 1 days,
            minProposalStake: 0.01 ether,
            quorumBps: 5000 // 50%
        });

        bytes32 jejuId = daoRegistry.createDAO(
            "jeju",
            "Jeju DAO",
            "Governance for Jeju Network - controls chain-level fees, treasury, and protocol evolution",
            deployer, // Treasury (should be multisig in production)
            "",
            jejuDirector,
            jejuParams
        );
        console.log("Jeju DAO created:");
        console.logBytes32(jejuId);

        // 5. Create Apps DAO
        string[] memory appsTraits = new string[](4);
        appsTraits[0] = "innovative";
        appsTraits[1] = "pragmatic";
        appsTraits[2] = "user-focused";
        appsTraits[3] = "growth-oriented";

        IDAORegistry.DirectorPersona memory appsDirector = IDAORegistry.DirectorPersona({
            name: "Apps Director",
            pfpCid: "",
            description: "The governance leader for Jeju applications, overseeing app-specific economics and incentives.",
            personality: "Innovative, user-focused, and pragmatic. Balances app growth with sustainable economics.",
            traits: appsTraits,
            isHuman: false,
            humanAddress: address(0),
            agentId: 0,
            decisionFallbackDays: 3
        });

        IDAORegistry.GovernanceParams memory appsParams = IDAORegistry.GovernanceParams({
            minQualityScore: 60, // Lower threshold for app-related proposals
            boardVotingPeriod: 2 days, // Faster for apps
            gracePeriod: 12 hours,
            minProposalStake: 0.005 ether,
            quorumBps: 4000 // 40%
        });

        bytes32 appsId = daoRegistry.createDAO(
            "apps",
            "Apps DAO",
            "Governance for Jeju applications - controls app fees, points, bonuses, airdrops, and app-specific economics",
            deployer, // Treasury (should be multisig in production)
            "",
            appsDirector,
            appsParams
        );
        console.log("Apps DAO created:");
        console.logBytes32(appsId);

        // 6. Set FeeConfig board
        feeConfig.setBoard(address(daoRegistry));
        console.log("FeeConfig board set to DAORegistry");

        vm.stopBroadcast();

        // Output deployment info for env file
        console.log("\n=== DEPLOYMENT INFO ===");
        console.log("Add these to your .env file:");
        console.log("");
        console.log("DAO_REGISTRY_ADDRESS=", address(daoRegistry));
        console.log("DAO_FUNDING_ADDRESS=", address(daoFunding));
        console.log("FEE_CONFIG_ADDRESS=", address(feeConfig));
        console.log("");
        console.log("JEJU_DAO_ID=");
        console.logBytes32(jejuId);
        console.log("APPS_DAO_ID=");
        console.logBytes32(appsId);
    }
}
