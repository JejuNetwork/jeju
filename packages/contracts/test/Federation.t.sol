// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {NetworkRegistry} from "../src/federation/NetworkRegistry.sol";
import {FederatedIdentity} from "../src/federation/FederatedIdentity.sol";
import {FederatedSolver} from "../src/federation/FederatedSolver.sol";
import {FederatedLiquidity} from "../src/federation/FederatedLiquidity.sol";

contract FederationTest is Test {
    NetworkRegistry public registry;
    FederatedIdentity public identity;
    FederatedSolver public solver;
    FederatedLiquidity public liquidity;

    address public operator = address(0x1);
    address public operator2 = address(0x2);
    address public user = address(0x3);
    address public oracle = address(0x4);

    uint256 public constant CHAIN_A = 420690;
    uint256 public constant CHAIN_B = 420691;
    uint256 public constant LOCAL_CHAIN = 1337;

    function setUp() public {
        vm.deal(operator, 100 ether);
        vm.deal(operator2, 100 ether);
        vm.deal(user, 10 ether);

        registry = new NetworkRegistry(address(this));
        
        identity = new FederatedIdentity(
            LOCAL_CHAIN,
            oracle,
            address(this),
            address(registry),
            address(0)
        );

        solver = new FederatedSolver(
            LOCAL_CHAIN,
            oracle,
            address(this),
            address(registry),
            address(0)
        );

        liquidity = new FederatedLiquidity(
            LOCAL_CHAIN,
            oracle,
            address(this),
            address(registry),
            address(0)
        );
    }

    function test_NetworkRegistry_RegisterNetwork() public {
        vm.startPrank(operator);

        NetworkRegistry.NetworkContracts memory contracts = NetworkRegistry.NetworkContracts({
            identityRegistry: address(identity),
            solverRegistry: address(solver),
            inputSettler: address(0x100),
            outputSettler: address(0x101),
            liquidityVault: address(liquidity),
            governance: address(0x102),
            oracle: oracle
        });

        registry.registerNetwork{value: 1 ether}(
            CHAIN_A,
            "Jeju Testnet",
            "https://rpc.testnet.jeju.network",
            "https://explorer.testnet.jeju.network",
            "wss://ws.testnet.jeju.network",
            contracts,
            bytes32(0)
        );

        NetworkRegistry.NetworkInfo memory info = registry.getNetwork(CHAIN_A);
        assertEq(info.chainId, CHAIN_A);
        assertEq(info.name, "Jeju Testnet");
        assertEq(info.operator, operator);
        assertEq(info.stake, 1 ether);
        assertTrue(info.isActive);
        assertFalse(info.isVerified);

        vm.stopPrank();
    }

    function test_NetworkRegistry_EstablishTrust() public {
        _registerTwoNetworks();

        vm.prank(operator);
        registry.establishTrust(CHAIN_A, CHAIN_B);

        assertTrue(registry.isTrusted(CHAIN_A, CHAIN_B));
        assertFalse(registry.isTrusted(CHAIN_B, CHAIN_A));
        assertFalse(registry.isMutuallyTrusted(CHAIN_A, CHAIN_B));

        vm.prank(operator2);
        registry.establishTrust(CHAIN_B, CHAIN_A);

        assertTrue(registry.isMutuallyTrusted(CHAIN_A, CHAIN_B));
    }

    function test_NetworkRegistry_VerifyNetwork() public {
        _registerOneNetwork();

        assertFalse(registry.getNetwork(CHAIN_A).isVerified);

        registry.verifyNetwork(CHAIN_A);

        assertTrue(registry.getNetwork(CHAIN_A).isVerified);
    }

    function test_NetworkRegistry_GetActiveNetworks() public {
        _registerTwoNetworks();

        uint256[] memory active = registry.getActiveNetworks();
        assertEq(active.length, 2);
    }

    function test_NetworkRegistry_DeactivateAndWithdraw() public {
        _registerOneNetwork();

        vm.startPrank(operator);
        
        registry.deactivateNetwork(CHAIN_A);
        assertFalse(registry.getNetwork(CHAIN_A).isActive);

        uint256 balanceBefore = operator.balance;
        registry.withdrawStake(CHAIN_A);
        assertEq(operator.balance - balanceBefore, 1 ether);

        vm.stopPrank();
    }

    function test_FederatedSolver_RegisterAndRoute() public {
        identity.setAttester(address(this), true);
        solver.setReporter(address(this), true);

        uint256[] memory chains = new uint256[](2);
        chains[0] = CHAIN_A;
        chains[1] = CHAIN_B;

        vm.prank(user);
        solver.federateLocalSolver(chains);

        bytes32[] memory solversForRoute = solver.getSolversForRoute(CHAIN_A, CHAIN_B);
        assertEq(solversForRoute.length, 1);

        bytes32 solverId = solver.computeFederatedSolverId(user, LOCAL_CHAIN);
        FederatedSolver.FederatedSolverInfo memory info = solver.getSolver(solverId);
        assertEq(info.solverAddress, user);
        assertEq(info.homeChainId, LOCAL_CHAIN);
        assertTrue(info.isActive);
    }

    function test_FederatedSolver_ReportFillsAndGetBest() public {
        solver.setReporter(address(this), true);

        uint256[] memory chains = new uint256[](2);
        chains[0] = CHAIN_A;
        chains[1] = CHAIN_B;

        vm.prank(user);
        solver.federateLocalSolver(chains);

        bytes32 solverId = solver.computeFederatedSolverId(user, LOCAL_CHAIN);

        solver.updateSolverStats(solverId, 10 ether, 100, 95);

        FederatedSolver.FederatedSolverInfo memory info = solver.getSolver(solverId);
        assertEq(info.totalStake, 10 ether);
        assertEq(info.totalFills, 100);
        assertEq(info.successfulFills, 95);

        (bytes32 bestId, uint256 stake, uint256 rate) = solver.getBestSolverForRoute(CHAIN_A, CHAIN_B);
        assertEq(bestId, solverId);
        assertEq(stake, 10 ether);
        assertEq(rate, 9500);
    }

    function test_FederatedLiquidity_RegisterXLP() public {
        uint256[] memory chains = new uint256[](2);
        chains[0] = CHAIN_A;
        chains[1] = CHAIN_B;

        vm.prank(user);
        liquidity.registerXLP(chains);

        FederatedLiquidity.XLP memory xlp = liquidity.getXLP(user);
        assertEq(xlp.provider, user);
        assertTrue(xlp.isActive);
        assertEq(xlp.supportedChains.length, 2);
    }

    function test_FederatedLiquidity_CreateAndFulfillRequest() public {
        uint256[] memory chains = new uint256[](2);
        chains[0] = LOCAL_CHAIN;
        chains[1] = CHAIN_A;

        vm.prank(operator);
        liquidity.registerXLP(chains);

        vm.prank(user);
        liquidity.createRequest{value: 1 ether}(address(0), 1 ether, CHAIN_A);

        bytes32[] memory pending = liquidity.getPendingRequests();
        assertEq(pending.length, 1);

        vm.prank(operator);
        liquidity.fulfillRequest(pending[0], "");

        pending = liquidity.getPendingRequests();
        assertEq(pending.length, 0);

        FederatedLiquidity.XLP memory xlp = liquidity.getXLP(operator);
        assertEq(xlp.totalProvided, 1 ether);
        assertGt(xlp.totalEarned, 0);
    }

    function test_FederatedLiquidity_UpdateNetworkLiquidity() public {
        liquidity.updateNetworkLiquidity(
            CHAIN_A,
            address(0x100),
            100 ether,
            1000e18,
            5000
        );

        FederatedLiquidity.NetworkLiquidity memory nl = liquidity.getNetworkLiquidity(CHAIN_A);
        assertEq(nl.chainId, CHAIN_A);
        assertEq(nl.ethLiquidity, 100 ether);
        assertEq(nl.tokenLiquidity, 1000e18);
        assertEq(nl.utilizationBps, 5000);
    }

    function test_FederatedLiquidity_GetBestNetwork() public {
        liquidity.updateNetworkLiquidity(CHAIN_A, address(0x100), 100 ether, 0, 3000);
        liquidity.updateNetworkLiquidity(CHAIN_B, address(0x101), 200 ether, 0, 2000);

        (uint256 bestChain, uint256 available) = liquidity.getBestNetworkForLiquidity(50 ether);
        assertEq(bestChain, CHAIN_B);
        assertEq(available, 200 ether);
    }

    function _registerOneNetwork() internal {
        vm.startPrank(operator);

        NetworkRegistry.NetworkContracts memory contracts = NetworkRegistry.NetworkContracts({
            identityRegistry: address(0),
            solverRegistry: address(0),
            inputSettler: address(0),
            outputSettler: address(0),
            liquidityVault: address(0),
            governance: address(0),
            oracle: address(0)
        });

        registry.registerNetwork{value: 1 ether}(
            CHAIN_A,
            "Network A",
            "https://rpc.a.network",
            "https://explorer.a.network",
            "wss://ws.a.network",
            contracts,
            bytes32(0)
        );

        vm.stopPrank();
    }

    function _registerTwoNetworks() internal {
        NetworkRegistry.NetworkContracts memory contracts = NetworkRegistry.NetworkContracts({
            identityRegistry: address(0),
            solverRegistry: address(0),
            inputSettler: address(0),
            outputSettler: address(0),
            liquidityVault: address(0),
            governance: address(0),
            oracle: address(0)
        });

        vm.prank(operator);
        registry.registerNetwork{value: 1 ether}(
            CHAIN_A,
            "Network A",
            "https://rpc.a.network",
            "https://explorer.a.network",
            "wss://ws.a.network",
            contracts,
            bytes32(0)
        );

        vm.prank(operator2);
        registry.registerNetwork{value: 1 ether}(
            CHAIN_B,
            "Network B",
            "https://rpc.b.network",
            "https://explorer.b.network",
            "wss://ws.b.network",
            contracts,
            bytes32(0)
        );
    }
}

