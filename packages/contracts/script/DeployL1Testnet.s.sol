// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

/**
 * @title DeployL1Testnet
 * @notice Deploys minimal L1 proxy contracts for Jeju Testnet on Sepolia
 * @dev Uses simplified proxies - full OP Stack requires op-deployer
 * 
 * Usage:
 *   PRIVATE_KEY=... forge script script/DeployL1Testnet.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast
 */
contract DeployL1Testnet is Script {
    // Testnet configuration
    uint256 constant L2_CHAIN_ID = 420690;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying L1 contracts for Jeju Testnet");
        console.log("Deployer:", deployer);
        console.log("L2 Chain ID:", L2_CHAIN_ID);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy minimal proxy contracts
        // These are placeholder proxies - actual implementations require op-deployer
        
        // ProxyAdmin
        MinimalProxy proxyAdmin = new MinimalProxy(deployer);
        console.log("ProxyAdmin:", address(proxyAdmin));
        
        // AddressManager
        AddressManager addressManager = new AddressManager();
        console.log("AddressManager:", address(addressManager));
        
        // L1 Contract Proxies (to be upgraded later)
        MinimalProxy systemConfig = new MinimalProxy(deployer);
        MinimalProxy optimismPortal = new MinimalProxy(deployer);
        MinimalProxy l1CrossDomainMessenger = new MinimalProxy(deployer);
        MinimalProxy l1StandardBridge = new MinimalProxy(deployer);
        
        console.log("SystemConfig:", address(systemConfig));
        console.log("OptimismPortal:", address(optimismPortal));
        console.log("L1CrossDomainMessenger:", address(l1CrossDomainMessenger));
        console.log("L1StandardBridge:", address(l1StandardBridge));
        
        vm.stopBroadcast();
        
        // Output deployment summary for config files
        console.log("\n========== L1 DEPLOYMENT COMPLETE ==========");
        console.log("PROXY_ADMIN=%s", address(proxyAdmin));
        console.log("ADDRESS_MANAGER=%s", address(addressManager));
        console.log("SYSTEM_CONFIG=%s", address(systemConfig));
        console.log("OPTIMISM_PORTAL=%s", address(optimismPortal));
        console.log("L1_CROSS_DOMAIN_MESSENGER=%s", address(l1CrossDomainMessenger));
        console.log("L1_STANDARD_BRIDGE=%s", address(l1StandardBridge));
        console.log("=============================================");
        console.log("\nNOTE: These are minimal proxies.");
        console.log("For full OP Stack, use op-deployer.");
    }
}

/// @notice Minimal proxy contract for testnet
contract MinimalProxy {
    address public owner;
    address public implementation;
    
    constructor(address _owner) {
        owner = _owner;
    }
    
    function setImplementation(address _impl) external {
        require(msg.sender == owner, "not owner");
        implementation = _impl;
    }
    
    fallback() external payable {
        address impl = implementation;
        if (impl == address(0)) return;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    receive() external payable {}
}

/// @notice Minimal address manager for testnet
contract AddressManager {
    mapping(string => address) private addresses;
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    function setAddress(string memory _name, address _address) external {
        require(msg.sender == owner, "not owner");
        addresses[_name] = _address;
    }
    
    function getAddress(string memory _name) external view returns (address) {
        return addresses[_name];
    }
}

