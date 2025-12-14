// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Create2Factory
 * @notice Deploys contracts with deterministic addresses using CREATE2
 * @dev Enables same addresses across all chains for unified deployment
 *
 * Key features:
 * - Deterministic addresses from salt
 * - Automatic proxy deployment for upgradeability
 * - Cross-chain address prediction
 */
contract Create2Factory is Ownable {
    // ============ Events ============

    event ContractDeployed(address indexed deployed, bytes32 indexed salt, bool isProxy);

    event ProxyUpgraded(address indexed proxy, address indexed oldImpl, address indexed newImpl);

    // ============ State ============

    /// @notice ProxyAdmin for all deployed proxies
    ProxyAdmin public immutable proxyAdmin;

    /// @notice Track deployed contracts
    mapping(bytes32 => address) public deployments;

    /// @notice Track proxy implementations
    mapping(address => address) public proxyImplementations;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        proxyAdmin = new ProxyAdmin(msg.sender);
    }

    // ============ Deployment Functions ============

    /**
     * @notice Deploy a contract using CREATE2
     * @param salt Unique salt for deterministic address
     * @param bytecode Contract creation code
     * @return deployed Address of deployed contract
     */
    function deploy(bytes32 salt, bytes memory bytecode) external onlyOwner returns (address deployed) {
        bytes32 fullSalt = keccak256(abi.encodePacked(msg.sender, salt));

        assembly {
            deployed := create2(0, add(bytecode, 32), mload(bytecode), fullSalt)
        }

        if (deployed == address(0)) revert("Create2: deployment failed");

        deployments[salt] = deployed;
        emit ContractDeployed(deployed, salt, false);
    }

    /**
     * @notice Deploy an upgradeable proxy using CREATE2
     * @param salt Unique salt for deterministic address
     * @param implementation Initial implementation address
     * @param initData Initialization calldata
     * @return proxy Address of deployed proxy
     */
    function deployProxy(bytes32 salt, address implementation, bytes memory initData)
        external
        onlyOwner
        returns (address proxy)
    {
        bytes32 fullSalt = keccak256(abi.encodePacked(msg.sender, salt));

        bytes memory proxyBytecode = abi.encodePacked(
            type(TransparentUpgradeableProxy).creationCode, abi.encode(implementation, address(proxyAdmin), initData)
        );

        assembly {
            proxy := create2(0, add(proxyBytecode, 32), mload(proxyBytecode), fullSalt)
        }

        if (proxy == address(0)) revert("Create2: proxy deployment failed");

        deployments[salt] = proxy;
        proxyImplementations[proxy] = implementation;
        emit ContractDeployed(proxy, salt, true);
    }

    /**
     * @notice Upgrade a proxy to a new implementation
     * @param proxy Proxy address
     * @param newImplementation New implementation address
     */
    function upgradeProxy(address proxy, address newImplementation) external onlyOwner {
        address oldImpl = proxyImplementations[proxy];
        if (oldImpl == address(0)) revert("Not a managed proxy");

        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), newImplementation, "");

        proxyImplementations[proxy] = newImplementation;
        emit ProxyUpgraded(proxy, oldImpl, newImplementation);
    }

    /**
     * @notice Upgrade a proxy with initialization
     * @param proxy Proxy address
     * @param newImplementation New implementation address
     * @param data Initialization calldata
     */
    function upgradeProxyAndCall(address proxy, address newImplementation, bytes memory data) external onlyOwner {
        address oldImpl = proxyImplementations[proxy];
        if (oldImpl == address(0)) revert("Not a managed proxy");

        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), newImplementation, data);

        proxyImplementations[proxy] = newImplementation;
        emit ProxyUpgraded(proxy, oldImpl, newImplementation);
    }

    // ============ View Functions ============

    /**
     * @notice Compute CREATE2 address for a contract
     * @param deployer Address that will call deploy()
     * @param salt Salt value
     * @param bytecodeHash Hash of contract bytecode
     */
    function computeAddress(address deployer, bytes32 salt, bytes32 bytecodeHash) external view returns (address) {
        bytes32 fullSalt = keccak256(abi.encodePacked(deployer, salt));
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), fullSalt, bytecodeHash)))));
    }

    /**
     * @notice Compute CREATE2 address for a proxy
     * @param deployer Address that will call deployProxy()
     * @param salt Salt value
     * @param implementation Implementation address
     * @param initData Initialization data
     */
    function computeProxyAddress(address deployer, bytes32 salt, address implementation, bytes memory initData)
        external
        view
        returns (address)
    {
        bytes32 fullSalt = keccak256(abi.encodePacked(deployer, salt));

        bytes memory proxyBytecode = abi.encodePacked(
            type(TransparentUpgradeableProxy).creationCode, abi.encode(implementation, address(proxyAdmin), initData)
        );

        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), fullSalt, keccak256(proxyBytecode))))
            )
        );
    }
}
