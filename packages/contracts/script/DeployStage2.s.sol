// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/stage2/SequencerRegistry.sol";
import "../src/stage2/GovernanceTimelock.sol";
import "../src/stage2/DisputeGameFactory.sol";
import "../src/stage2/provers/Prover.sol";
import "../src/stage2/L2OutputOracleAdapter.sol";
import "../src/stage2/OptimismPortalAdapter.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJUToken is ERC20 {
    constructor() ERC20("JEJU", "JEJU") { _mint(msg.sender, 10_000_000 ether); }
}

contract DeployStage2 is Script {
    // Configuration
    uint256 constant TIMELOCK_DELAY = 30 days;
    uint256 constant EMERGENCY_DELAY = 1 hours;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Required addresses (from env or defaults)
        address jejuToken = vm.envOr("JEJU_TOKEN", address(0));
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        address treasury = vm.envOr("TREASURY", deployer);
        address governance = vm.envOr("GOVERNANCE", deployer);
        address securityCouncil = vm.envOr("SECURITY_COUNCIL", deployer);
        address l2OutputOracle = vm.envOr("L2_OUTPUT_ORACLE", address(0));

        console.log("==================================================");
        console.log("Deploying Stage 2 Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Governance:", governance);
        console.log("Security Council:", securityCouncil);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock dependencies for localnet if not provided
        if (jejuToken == address(0) || identityRegistry == address(0) || reputationRegistry == address(0)) {
            console.log("Deploying mock dependencies for local testing...");
            
            MockJEJUToken mockToken = new MockJEJUToken();
            jejuToken = address(mockToken);
            console.log("MockJEJUToken deployed:", jejuToken);
            
            IdentityRegistry idRegistry = new IdentityRegistry();
            identityRegistry = address(idRegistry);
            console.log("IdentityRegistry deployed:", identityRegistry);
            
            ReputationRegistry repRegistry = new ReputationRegistry(payable(identityRegistry));
            reputationRegistry = address(repRegistry);
            console.log("ReputationRegistry deployed:", reputationRegistry);
            console.log("");
        }

        // 1. Deploy SequencerRegistry
        SequencerRegistry sequencerRegistry = new SequencerRegistry(
            jejuToken,
            identityRegistry,
            reputationRegistry,
            treasury,
            deployer
        );
        console.log("SequencerRegistry deployed:", address(sequencerRegistry));

        // 2. Deploy GovernanceTimelock
        GovernanceTimelock timelock = new GovernanceTimelock(
            governance,
            securityCouncil,
            deployer,
            TIMELOCK_DELAY
        );
        console.log("GovernanceTimelock deployed:", address(timelock));
        console.log("  - Timelock delay:", TIMELOCK_DELAY / 1 days, "days");
        console.log("  - Emergency delay:", EMERGENCY_DELAY / 1 hours, "hours");

        // 3. Deploy DisputeGameFactory
        DisputeGameFactory disputeFactory = new DisputeGameFactory(treasury, deployer);
        console.log("DisputeGameFactory deployed:", address(disputeFactory));

        // 4. Deploy Prover
        Prover prover = new Prover();
        console.log("Prover deployed:", address(prover));

        // 5. Enable Prover in DisputeGameFactory
        disputeFactory.setProverImplementation(
            DisputeGameFactory.ProverType.CANNON,
            address(prover),
            true
        );
        console.log("  - Prover enabled as CANNON prover");

        // 6. Deploy L2OutputOracleAdapter
        L2OutputOracleAdapter l2Adapter = new L2OutputOracleAdapter(
            address(sequencerRegistry),
            payable(address(disputeFactory)),
            l2OutputOracle
        );
        console.log("L2OutputOracleAdapter deployed:", address(l2Adapter));

        // 7. Deploy OptimismPortalAdapter
        OptimismPortalAdapter portalAdapter = new OptimismPortalAdapter(
            address(timelock),
            securityCouncil
        );
        console.log("OptimismPortalAdapter deployed:", address(portalAdapter));

        // Transfer ownership to timelock for decentralization
        sequencerRegistry.transferOwnership(address(timelock));
        disputeFactory.transferOwnership(address(timelock));
        l2Adapter.transferOwnership(address(timelock));
        console.log("");
        console.log("Ownership transferred to GovernanceTimelock");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("Stage 2 Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("Addresses:");
        console.log("  SequencerRegistry:", address(sequencerRegistry));
        console.log("  GovernanceTimelock:", address(timelock));
        console.log("  DisputeGameFactory:", address(disputeFactory));
        console.log("  Prover:", address(prover));
        console.log("  L2OutputOracleAdapter:", address(l2Adapter));
        console.log("  OptimismPortalAdapter:", address(portalAdapter));
    }
}
