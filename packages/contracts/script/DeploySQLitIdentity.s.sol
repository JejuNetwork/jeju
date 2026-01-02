// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/sqlit/SQLitIdentityRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJEJU is ERC20 {
    constructor() ERC20("Mock JEJU", "JEJU") {
        _mint(msg.sender, 1000000 ether);
    }
}

contract DeploySQLitIdentity is Script {
    function run() external {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        
        vm.startBroadcast();

        MockJEJU jeju = new MockJEJU();
        console.log("MockJEJU deployed at:", address(jeju));

        SQLitIdentityRegistry registry = new SQLitIdentityRegistry(address(jeju), deployer);
        console.log("SQLitIdentityRegistry deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
