// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {MessageNodeRegistry} from "../../src/messaging/MessageNodeRegistry.sol";
import {PerformanceMetrics} from "../../src/registry/PerformanceMetrics.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

// Mock ERC20 for testing
contract MockJEJU is IERC20 {
    string public constant name = "Mock JEJU";
    string public constant symbol = "mJEJU";
    uint8 public constant decimals = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    function mint(address to, uint256 amount) external {
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        _allowances[from][msg.sender] = currentAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "Insufficient balance");
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MessageNodeRegistryTest is Test {
    MessageNodeRegistry public registry;
    MockJEJU public token;

    address public owner = address(this);
    address public operator1 = address(0x1);
    address public operator2 = address(0x2);
    address public oracleAddr = address(0x3);

    uint256 public constant MIN_STAKE = 1000 ether;
    uint256 public constant ORACLE_STAKE = 10000 ether;
    string public constant ENDPOINT = "https://relay1.jejunetwork.org";
    string public constant REGION = "us-west-2";

    function setUp() public {
        token = new MockJEJU();
        registry = new MessageNodeRegistry(address(token), owner);

        // Fund operators and oracle
        token.mint(operator1, 100000 ether);
        token.mint(operator2, 100000 ether);
        token.mint(oracleAddr, 100000 ether);

        // Approve registry
        vm.prank(operator1);
        token.approve(address(registry), type(uint256).max);

        vm.prank(operator2);
        token.approve(address(registry), type(uint256).max);

        vm.prank(oracleAddr);
        token.approve(address(registry), type(uint256).max);

        // Register oracle
        vm.prank(oracleAddr);
        registry.registerOracle(ORACLE_STAKE);
    }

    // ============ Oracle Tests ============

    function test_RegisterOracle() public {
        address newOracle = address(0x999);
        token.mint(newOracle, 100000 ether);

        vm.prank(newOracle);
        token.approve(address(registry), type(uint256).max);

        vm.prank(newOracle);
        registry.registerOracle(ORACLE_STAKE);

        MessageNodeRegistry.OracleInfo memory info = registry.getOracleInfo(newOracle);
        assertTrue(info.isActive);
        assertEq(info.stakedAmount, ORACLE_STAKE);
    }

    function test_DeregisterOracle() public {
        uint256 balanceBefore = token.balanceOf(oracleAddr);

        vm.prank(oracleAddr);
        registry.deregisterOracle();

        uint256 balanceAfter = token.balanceOf(oracleAddr);
        assertEq(balanceAfter - balanceBefore, ORACLE_STAKE);

        MessageNodeRegistry.OracleInfo memory info = registry.getOracleInfo(oracleAddr);
        assertFalse(info.isActive);
    }

    // ============ Registration Tests ============

    function test_RegisterNode() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        MessageNodeRegistry.NodeInfo memory node = registry.getNode(nodeId);

        assertEq(node.operator, operator1);
        assertEq(node.endpoint, ENDPOINT);
        assertEq(node.region, REGION);
        assertEq(node.stakedAmount, MIN_STAKE);
        assertTrue(node.isActive);
        assertFalse(node.isSlashed);
    }

    function test_RevertWhen_InsufficientStake() public {
        vm.expectRevert(abi.encodeWithSelector(MessageNodeRegistry.InsufficientStake.selector, 500 ether, MIN_STAKE));
        vm.prank(operator1);
        registry.registerNode(ENDPOINT, REGION, 500 ether);
    }

    function test_RevertWhen_EmptyEndpoint() public {
        vm.expectRevert(MessageNodeRegistry.InvalidEndpoint.selector);
        vm.prank(operator1);
        registry.registerNode("", REGION, MIN_STAKE);
    }

    function test_RevertWhen_EmptyRegion() public {
        vm.expectRevert(MessageNodeRegistry.InvalidRegion.selector);
        vm.prank(operator1);
        registry.registerNode(ENDPOINT, "", MIN_STAKE);
    }

    // ============ Deregistration Tests ============

    function test_DeregisterNode() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        // Fast forward past minimum staking period
        vm.warp(block.timestamp + 8 days);

        uint256 balanceBefore = token.balanceOf(operator1);

        vm.prank(operator1);
        registry.deregisterNode(nodeId);

        uint256 balanceAfter = token.balanceOf(operator1);

        assertEq(balanceAfter - balanceBefore, MIN_STAKE);

        MessageNodeRegistry.NodeInfo memory node = registry.getNode(nodeId);
        assertFalse(node.isActive);
    }

    function test_RevertWhen_DeregisterTooEarly() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.expectRevert();
        vm.prank(operator1);
        registry.deregisterNode(nodeId);
    }

    function test_RevertWhen_DeregisterUnauthorized() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.warp(block.timestamp + 8 days);

        vm.expectRevert(MessageNodeRegistry.Unauthorized.selector);
        vm.prank(operator2);
        registry.deregisterNode(nodeId);
    }

    // ============ Heartbeat Tests ============

    function test_Heartbeat() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.warp(block.timestamp + 5 minutes);

        vm.prank(operator1);
        registry.heartbeat(nodeId);

        MessageNodeRegistry.NodeInfo memory node = registry.getNode(nodeId);
        assertEq(node.lastHeartbeat, block.timestamp);
    }

    function test_RevertWhen_HeartbeatTooFrequent() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.warp(block.timestamp + 1 minutes); // Too soon

        vm.expectRevert(MessageNodeRegistry.HeartbeatTooFrequent.selector);
        vm.prank(operator1);
        registry.heartbeat(nodeId);
    }

    // ============ Performance & Fees Tests ============

    function test_RecordMessageRelay() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.prank(oracleAddr);
        registry.recordMessageRelay(nodeId, 10);

        MessageNodeRegistry.NodeInfo memory node = registry.getNode(nodeId);
        assertEq(node.messagesRelayed, 10);
        assertGt(node.feesEarned, 0);
    }

    function test_OracleFeeLimitEnforced() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        // Try to credit too many fees
        uint256 maxFees = registry.maxFeesPerOraclePeriod();
        uint256 baseFee = registry.baseFeePerMessage();
        uint256 tooManyMessages = (maxFees / baseFee) + 1000;

        vm.expectRevert(MessageNodeRegistry.OracleFeeLimitExceeded.selector);
        vm.prank(oracleAddr);
        registry.recordMessageRelay(nodeId, tooManyMessages);
    }

    function test_ClaimFees() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        // Record some messages
        vm.prank(oracleAddr);
        registry.recordMessageRelay(nodeId, 100);

        uint256 pendingFees = registry.pendingFees(nodeId);
        assertGt(pendingFees, 0);

        uint256 balanceBefore = token.balanceOf(operator1);

        vm.prank(operator1);
        registry.claimFees(nodeId);

        uint256 balanceAfter = token.balanceOf(operator1);
        assertEq(balanceAfter - balanceBefore, pendingFees);
    }

    function test_UpdatePerformance() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.prank(oracleAddr);
        registry.updatePerformance(nodeId, 9500, 9800, 50);

        PerformanceMetrics.Metrics memory perf = registry.getPerformance(nodeId);
        assertGt(perf.uptimeScore, 9000);
        assertGt(perf.successRate, 9000);
        assertEq(perf.avgLatencyMs, 50);
    }

    function test_PerformanceMetricsCapped() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        // Try to set values over 100%
        vm.prank(oracleAddr);
        registry.updatePerformance(nodeId, 20000, 15000, 50);

        PerformanceMetrics.Metrics memory perf = registry.getPerformance(nodeId);
        // Should be capped and averaged
        assertLe(perf.uptimeScore, 10000);
        assertLe(perf.successRate, 10000);
    }

    // ============ Slashing Tests ============

    function test_SlashNode() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        uint256 protocolFeesBefore = registry.protocolFees();

        registry.slashNode(nodeId, "Data leak detected");

        MessageNodeRegistry.NodeInfo memory node = registry.getNode(nodeId);
        assertTrue(node.isSlashed);
        assertFalse(node.isActive);
        assertLt(node.stakedAmount, MIN_STAKE);

        uint256 protocolFeesAfter = registry.protocolFees();
        assertGt(protocolFeesAfter, protocolFeesBefore);
    }

    function test_RecoverSlashedStake() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        registry.slashNode(nodeId, "Test slash");

        MessageNodeRegistry.NodeInfo memory slashedNode = registry.getNode(nodeId);
        uint256 remaining = slashedNode.stakedAmount;
        assertGt(remaining, 0); // 50% should remain

        // Cannot recover immediately
        vm.expectRevert(MessageNodeRegistry.SlashCooldownNotMet.selector);
        vm.prank(operator1);
        registry.recoverSlashedStake(nodeId);

        // Fast forward past cooldown
        vm.warp(block.timestamp + 31 days);

        uint256 balanceBefore = token.balanceOf(operator1);

        vm.prank(operator1);
        registry.recoverSlashedStake(nodeId);

        uint256 balanceAfter = token.balanceOf(operator1);
        assertEq(balanceAfter - balanceBefore, remaining);
    }

    function test_RevertWhen_SlashUnauthorized() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.expectRevert();
        vm.prank(operator2);
        registry.slashNode(nodeId, "Attempted unauthorized slash");
    }

    // ============ View Function Tests ============

    function test_GetActiveNodes() public {
        vm.prank(operator1);
        registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        vm.prank(operator2);
        registry.registerNode("https://relay2.jejunetwork.org", "eu-west-1", MIN_STAKE);

        bytes32[] memory activeNodes = registry.getActiveNodes();
        assertEq(activeNodes.length, 2);
    }

    function test_GetNodesByRegion() public {
        vm.prank(operator1);
        registry.registerNode(ENDPOINT, "us-west-2", MIN_STAKE);

        vm.prank(operator2);
        registry.registerNode("https://relay2.jejunetwork.org", "us-west-2", MIN_STAKE);

        bytes32[] memory usWestNodes = registry.getNodesByRegion("us-west-2");
        assertEq(usWestNodes.length, 2);
    }

    function test_IsNodeHealthy() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        assertTrue(registry.isNodeHealthy(nodeId));

        // Fast forward past heartbeat threshold
        vm.warp(block.timestamp + 20 minutes);

        assertFalse(registry.isNodeHealthy(nodeId));
    }

    function test_GetRandomHealthyNode() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        (bytes32 selectedId, string memory endpoint) = registry.getRandomHealthyNode("");

        assertEq(selectedId, nodeId);
        assertEq(endpoint, ENDPOINT);
    }

    // ============ Admin Function Tests ============

    function test_SetMinStake() public {
        uint256 newMinStake = 2000 ether;
        registry.setMinStake(newMinStake);
        assertEq(registry.minStake(), newMinStake);
    }

    function test_SetMinStake_RejectsInvalidValues() public {
        vm.expectRevert(MessageNodeRegistry.InvalidParameter.selector);
        registry.setMinStake(10 ether); // Too low

        vm.expectRevert(MessageNodeRegistry.InvalidParameter.selector);
        registry.setMinStake(2_000_000 ether); // Too high
    }

    function test_SetHeartbeatInterval_RejectsInvalidValues() public {
        vm.expectRevert(MessageNodeRegistry.InvalidParameter.selector);
        registry.setHeartbeatInterval(30 seconds); // Too short

        vm.expectRevert(MessageNodeRegistry.InvalidParameter.selector);
        registry.setHeartbeatInterval(2 days); // Too long
    }

    function test_SetProtocolFeeBPS_RejectsHighFee() public {
        vm.expectRevert(MessageNodeRegistry.InvalidParameter.selector);
        registry.setProtocolFeeBPS(3000); // 30% is too high
    }

    function test_ClaimProtocolFees() public {
        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        // Generate fees via slashing
        registry.slashNode(nodeId, "Test slash");

        uint256 protocolFees = registry.protocolFees();
        assertGt(protocolFees, 0);

        address recipient = address(0x999);
        registry.claimProtocolFees(recipient);

        assertEq(token.balanceOf(recipient), protocolFees);
    }

    function test_PauseAndUnpause() public {
        registry.pause();

        vm.expectRevert();
        vm.prank(operator1);
        registry.registerNode(ENDPOINT, REGION, MIN_STAKE);

        registry.unpause();

        vm.prank(operator1);
        bytes32 nodeId = registry.registerNode(ENDPOINT, REGION, MIN_STAKE);
        assertTrue(registry.getNode(nodeId).isActive);
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.1.0");
    }
}
