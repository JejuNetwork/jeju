// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CrossChainNFT} from "../src/bridge/nfteil/CrossChainNFT.sol";
import {CrossChainMultiToken} from "../src/bridge/nfteil/CrossChainMultiToken.sol";
import {WrappedNFT} from "../src/bridge/nfteil/WrappedNFT.sol";
import {NFTPaymaster} from "../src/bridge/nfteil/NFTPaymaster.sol";
import {NFTInputSettler} from "../src/bridge/nfteil/NFTInputSettler.sol";

/**
 * @title DeployNFTEIL
 * @notice Deployment script for NFT cross-chain infrastructure
 * @dev Deploys all contracts needed for cross-chain NFT transfers:
 *      - WrappedNFT: Protocol-owned wrapped NFT contract
 *      - NFTPaymaster: XLP fast-path for EIL
 *      - NFTInputSettler: OIF intent-based transfers
 *
 * Usage:
 *   forge script script/DeployNFTEIL.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - L1_STAKE_MANAGER: Address of L1StakeManager (for NFTPaymaster)
 *   - ORACLE_ADDRESS: Address of Oracle contract (for NFTInputSettler)
 *   - SOLVER_REGISTRY: Address of SolverRegistry (for NFTInputSettler)
 *   - MAILBOX: Hyperlane mailbox address (for CrossChainNFT/MultiToken)
 *   - IGP: Interchain Gas Paymaster address
 */
contract DeployNFTEIL is Script {
    // Deployed contract addresses
    WrappedNFT public wrappedNFT;
    NFTPaymaster public nftPaymaster;
    NFTInputSettler public nftInputSettler;

    // Configuration
    address public deployer;
    uint256 public chainId;

    function run() external virtual {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        chainId = block.chainid;

        console.log("=== NFT-EIL Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", chainId);
        console.log("");

        vm.startBroadcast(deployerKey);

        // Deploy WrappedNFT
        deployWrappedNFT();

        // Deploy NFTPaymaster (EIL)
        deployNFTPaymaster();

        // Deploy NFTInputSettler (OIF)
        deployNFTInputSettler();

        // Configure
        configure();

        vm.stopBroadcast();

        // Log summary
        logDeployment();
    }

    function deployWrappedNFT() internal {
        console.log("Deploying WrappedNFT...");
        
        wrappedNFT = new WrappedNFT(
            "Jeju Wrapped NFT",
            "jwNFT",
            deployer
        );
        
        console.log("  WrappedNFT:", address(wrappedNFT));
    }

    function deployNFTPaymaster() internal {
        console.log("Deploying NFTPaymaster...");
        
        address l1StakeManager = vm.envOr("L1_STAKE_MANAGER", address(0));
        
        nftPaymaster = new NFTPaymaster(
            chainId,
            l1StakeManager
        );
        
        console.log("  NFTPaymaster:", address(nftPaymaster));
        console.log("  L1StakeManager:", l1StakeManager);
    }

    function deployNFTInputSettler() internal {
        console.log("Deploying NFTInputSettler...");
        
        address oracle = vm.envOr("ORACLE_ADDRESS", address(0));
        address solverRegistry = vm.envOr("SOLVER_REGISTRY", address(0));
        
        nftInputSettler = new NFTInputSettler(
            chainId,
            oracle,
            solverRegistry
        );
        
        console.log("  NFTInputSettler:", address(nftInputSettler));
        console.log("  Oracle:", oracle);
        console.log("  SolverRegistry:", solverRegistry);
    }

    function configure() internal {
        console.log("Configuring...");
        
        // Authorize NFTPaymaster to wrap NFTs
        wrappedNFT.authorizeBridge(address(nftPaymaster), true);
        console.log("  Authorized NFTPaymaster as bridge");
        
        // Authorize NFTInputSettler to wrap NFTs
        wrappedNFT.authorizeBridge(address(nftInputSettler), true);
        console.log("  Authorized NFTInputSettler as bridge");
    }

    function logDeployment() internal view {
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("");
        console.log("WrappedNFT:", address(wrappedNFT));
        console.log("NFTPaymaster:", address(nftPaymaster));
        console.log("NFTInputSettler:", address(nftInputSettler));
        console.log("");
        console.log("=== Environment Variables ===");
        console.log("");
        console.log("NFTEIL_WRAPPED_NFT=", address(wrappedNFT));
        console.log("NFTEIL_PAYMASTER=", address(nftPaymaster));
        console.log("NFTEIL_INPUT_SETTLER=", address(nftInputSettler));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Deploy CrossChainNFT collections with Hyperlane");
        console.log("2. Configure routers between chains");
        console.log("3. Register supported collections in NFTPaymaster");
        console.log("4. Set up XLPs with L1StakeManager");
    }
}

/**
 * @title DeployNFTEILTestnet
 * @notice Testnet-specific deployment with mock contracts
 */
contract DeployNFTEILTestnet is DeployNFTEIL {
    function run() external override {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        chainId = block.chainid;

        console.log("=== NFT-EIL Testnet Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", chainId);
        console.log("");

        vm.startBroadcast(deployerKey);

        // Deploy mock L1StakeManager if not provided
        address l1StakeManager = vm.envOr("L1_STAKE_MANAGER", address(0));
        if (l1StakeManager == address(0)) {
            l1StakeManager = deployMockL1StakeManager();
        }

        // Deploy mock Oracle if not provided
        address oracle = vm.envOr("ORACLE_ADDRESS", address(0));
        if (oracle == address(0)) {
            oracle = deployMockOracle();
        }

        // Now deploy main contracts
        deployWrappedNFT();
        
        // Override env for paymaster
        vm.setEnv("L1_STAKE_MANAGER", vm.toString(l1StakeManager));
        deployNFTPaymaster();
        
        // Override env for settler
        vm.setEnv("ORACLE_ADDRESS", vm.toString(oracle));
        deployNFTInputSettler();

        configure();

        // Deploy a test NFT collection
        TestNFT testNFT = new TestNFT(deployer);
        console.log("Test NFT Collection:", address(testNFT));

        vm.stopBroadcast();

        logDeployment();
        console.log("TestNFT:", address(testNFT));
    }

    function deployMockL1StakeManager() internal returns (address) {
        console.log("Deploying MockL1StakeManager...");
        MockL1StakeManager mock = new MockL1StakeManager();
        console.log("  MockL1StakeManager:", address(mock));
        return address(mock);
    }

    function deployMockOracle() internal returns (address) {
        console.log("Deploying MockOracle...");
        MockOracle mock = new MockOracle();
        console.log("  MockOracle:", address(mock));
        return address(mock);
    }
}

// ============ Test Contracts ============

contract MockL1StakeManager {
    mapping(address => uint256) public stakes;

    function getStake(address xlp) external view returns (uint256) {
        return stakes[xlp];
    }

    function registerXLP() external payable {
        stakes[msg.sender] = msg.value;
    }
}

contract MockOracle {
    mapping(bytes32 => bool) public attestations;

    function hasAttested(bytes32 orderId) external view returns (bool) {
        return attestations[orderId];
    }

    function attest(bytes32 orderId) external {
        attestations[orderId] = true;
    }
}

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestNFT is ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    constructor(address owner) ERC721("Test NFT", "TNFT") Ownable(owner) {}

    function mint(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }
}
