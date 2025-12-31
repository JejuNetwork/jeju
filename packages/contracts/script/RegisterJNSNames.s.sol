// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "forge-std/console.sol";

interface IJNSRegistrar {
    function register(string calldata name, address owner_, uint256 duration) external payable returns (bytes32);
    function claimReserved(string calldata name, address owner_, uint256 duration) external payable returns (bytes32);
    function rentPrice(string calldata name, uint256 duration) external view returns (uint256);
    function available(string calldata name) external view returns (bool);
    function reservedNames(bytes32 labelhash) external view returns (bool);
    function setReserved(string calldata name, bool reserved) external;
}

interface IJNSResolver {
    function setAddr(bytes32 node, address addr) external;
    function setContenthash(bytes32 node, bytes calldata hash) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

/**
 * @title RegisterJNSNames
 * @notice Register test JNS names for platform services
 *
 * Run: forge script script/RegisterJNSNames.s.sol:RegisterJNSNames --rpc-url jeju_testnet --broadcast
 */
contract RegisterJNSNames is Script {
    // Testnet addresses from contracts.json
    address constant REGISTRAR = 0x0B306BF915C4d645ff596e518fAf3F9669b97016;
    address constant RESOLVER = 0x9A676e781A523b5d0C0e43731313A708CB607508;

    // 1 year duration
    uint256 constant DURATION = 365 days;

    // Base node for .jeju
    bytes32 constant BASE_NODE = keccak256(abi.encodePacked(bytes32(0), keccak256("jeju")));

    function run() external {
        address deployer = msg.sender;

        console.log("==================================================");
        console.log("Registering JNS Names for Platform Services");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Registrar:", REGISTRAR);
        console.log("Resolver:", RESOLVER);

        IJNSRegistrar registrar = IJNSRegistrar(REGISTRAR);
        IJNSResolver resolver = IJNSResolver(RESOLVER);

        vm.startBroadcast();

        // Reserved names to claim (platform services)
        string[8] memory reservedNames = [
            "gateway",
            "bazaar",
            "crucible",
            "wallet",
            "dws",
            "docs",
            "monitoring",
            "indexer"
        ];

        // Regular names to register
        string[5] memory regularNames = [
            "oauth3",
            "autocrat",
            "otto",
            "vpn",
            "example"
        ];

        uint256 totalCost;

        // Register reserved names using claimReserved
        console.log("");
        console.log("Claiming Reserved Names:");
        for (uint i = 0; i < reservedNames.length; i++) {
            string memory name = reservedNames[i];
            bytes32 labelhash = keccak256(bytes(name));

            // Check if actually reserved
            bool isReserved = registrar.reservedNames(labelhash);
            if (!isReserved) {
                console.log(string.concat("  ", name, " - not reserved, skipping claimReserved"));
                // Try regular registration instead
                if (registrar.available(name)) {
                    uint256 price = registrar.rentPrice(name, DURATION);
                    console.log(string.concat("    Registering normally for ", vm.toString(price), " wei"));
                    registrar.register{value: price}(name, deployer, DURATION);
                    totalCost += price;
                    _setResolverRecords(resolver, name, deployer);
                }
                continue;
            }

            uint256 price = registrar.rentPrice(name, DURATION);
            console.log(string.concat("  ", name, " - price: ", vm.toString(price), " wei"));

            bytes32 node = registrar.claimReserved{value: price}(name, deployer, DURATION);
            totalCost += price;
            console.log("    Registered! Node:", vm.toString(node));

            // Set resolver records
            _setResolverRecords(resolver, name, deployer);
        }

        // Register regular names
        console.log("");
        console.log("Registering Regular Names:");
        for (uint i = 0; i < regularNames.length; i++) {
            string memory name = regularNames[i];

            if (!registrar.available(name)) {
                console.log(string.concat("  ", name, " - already registered, skipping"));
                continue;
            }

            uint256 price = registrar.rentPrice(name, DURATION);
            console.log(string.concat("  ", name, " - price: ", vm.toString(price), " wei"));

            bytes32 node = registrar.register{value: price}(name, deployer, DURATION);
            totalCost += price;
            console.log("    Registered! Node:", vm.toString(node));

            // Set resolver records
            _setResolverRecords(resolver, name, deployer);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("JNS Registration Complete");
        console.log("==================================================");
        console.log(string.concat("Total cost: ", vm.toString(totalCost), " wei"));
        console.log(string.concat("Total cost: ", vm.toString(totalCost / 1e15), " finney"));
    }

    function _setResolverRecords(IJNSResolver resolver, string memory name, address owner) internal {
        bytes32 node = _namehash(name);

        // Set address record
        resolver.setAddr(node, owner);

        // Set text records for app metadata
        resolver.setText(node, "url", string(abi.encodePacked("https://", name, ".testnet.jejunetwork.org")));
        resolver.setText(node, "description", string(abi.encodePacked("Jeju ", name, " service")));

        console.log("    Set resolver records for", name, ".jeju");
    }

    function _namehash(string memory name) internal pure returns (bytes32) {
        bytes32 labelhash = keccak256(bytes(name));
        return keccak256(abi.encodePacked(BASE_NODE, labelhash));
    }
}
