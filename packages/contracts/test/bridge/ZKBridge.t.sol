// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/bridge/zk/ZKBridge.sol";
import "../../src/bridge/zk/GovernedZKBridge.sol";
import "../../src/bridge/zk/SolanaLightClient.sol";
import "../../src/governance/interfaces/ICouncilGovernance.sol";

/**
 * @title ZKBridgeTest
 * @notice Tests for ZK bridge contracts
 */

// Mock identity registry for testing
contract MockIdentityRegistry {
    struct Agent {
        uint8 tier;
        bool isBanned;
    }

    mapping(address => uint256) private _balances;
    mapping(address => uint256[]) private _tokens;
    mapping(uint256 => Agent) private _agents;
    uint256 private _nextId = 1;

    function registerAgent(address owner, uint8 tier) external returns (uint256) {
        uint256 id = _nextId++;
        _balances[owner] = 1;
        _tokens[owner].push(id);
        _agents[id] = Agent(tier, false);
        return id;
    }

    function banAgent(uint256 agentId) external {
        _agents[agentId].isBanned = true;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256) {
        return _tokens[owner][index];
    }

    function getAgent(uint256 agentId) external view returns (IBridgeIdentityRegistry.AgentRegistration memory) {
        Agent memory a = _agents[agentId];
        return IBridgeIdentityRegistry.AgentRegistration({
            agentId: agentId,
            owner: address(0),
            tier: IBridgeIdentityRegistry.StakeTier(a.tier),
            stakedToken: address(0),
            stakedAmount: 0,
            registeredAt: 0,
            lastActivityAt: 0,
            isBanned: a.isBanned,
            isSlashed: false
        });
    }
}

// Mock light client
contract MockSolanaLightClient is ISolanaLightClient {
    mapping(uint64 => bool) private _verifiedSlots;
    mapping(uint64 => bytes32) private _bankHashes;
    uint64 private _latestSlot;

    function setSlotVerified(uint64 slot, bytes32 bankHash) external {
        _verifiedSlots[slot] = true;
        _bankHashes[slot] = bankHash;
        if (slot > _latestSlot) _latestSlot = slot;
    }

    function isSlotVerified(uint64 slot) external view returns (bool) {
        return _verifiedSlots[slot];
    }

    function getBankHash(uint64 slot) external view returns (bytes32) {
        return _bankHashes[slot];
    }

    function getLatestSlot() external view returns (uint64) {
        return _latestSlot;
    }

    function getCurrentEpoch() external pure returns (uint64, bytes32) {
        return (0, bytes32(0));
    }

    function updateState(uint64, bytes32, bytes32, uint256[8] calldata, uint256[] calldata) external {}
}

// Mock council for governance tests
contract MockCouncil is ICouncilGovernance {
    mapping(bytes32 => Proposal) private _proposals;
    mapping(bytes32 => bool) private _approved;
    mapping(bytes32 => bool) private _graceDone;

    function createProposal(bytes32 proposalId, address target) external {
        _proposals[proposalId].proposalId = proposalId;
        _proposals[proposalId].targetContract = target;
    }

    function approveProposal(bytes32 proposalId) external {
        _approved[proposalId] = true;
    }

    function completeGrace(bytes32 proposalId) external {
        _graceDone[proposalId] = true;
    }

    function isProposalApproved(bytes32 proposalId) external view returns (bool) {
        return _approved[proposalId];
    }

    function isGracePeriodComplete(bytes32 proposalId) external view returns (bool) {
        return _graceDone[proposalId];
    }

    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function markExecuting(bytes32) external {}
    function markCompleted(bytes32) external {}
    function markFailed(bytes32, string calldata) external {}
}

// Mock ZK verifier
contract MockZKVerifier {
    function verifyProof(uint256[8] calldata proof, uint256[] calldata publicInputs) external pure returns (bool) {
        // Mock: accept any non-zero proof
        bool hasNonZero = false;
        for (uint256 i = 0; i < 8; i++) {
            if (proof[i] != 0) {
                hasNonZero = true;
                break;
            }
        }
        return hasNonZero && publicInputs.length > 0;
    }
}

// Mock bridge token
contract MockBridgeToken {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public authorized;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function bridgeMint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function bridgeBurn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
    }
}

contract ZKBridgeTest is Test {
    ZKBridge public bridge;
    MockIdentityRegistry public identityRegistry;
    MockSolanaLightClient public lightClient;
    MockZKVerifier public verifier;
    MockBridgeToken public token;

    address public admin;
    address public user;

    bytes32 public constant SOLANA_MINT = bytes32(uint256(1));

    function setUp() public {
        admin = address(this);
        user = address(0x456);

        // Deploy mocks
        identityRegistry = new MockIdentityRegistry();
        lightClient = new MockSolanaLightClient();
        verifier = new MockZKVerifier();
        token = new MockBridgeToken();

        // Deploy bridge
        bridge = new ZKBridge(address(lightClient), address(identityRegistry), address(verifier), 0.001 ether, 100 wei);

        // Register token
        bridge.registerToken(address(token), SOLANA_MINT, true);

        // Register user as agent with MEDIUM tier
        identityRegistry.registerAgent(user, 2);

        // Give user tokens
        token.mint(user, 1000 ether);
        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);
    }

    function test_Initialization() public view {
        assertEq(address(bridge.lightClient()), address(lightClient));
        assertEq(address(bridge.identityRegistry()), address(identityRegistry));
        assertEq(bridge.baseFee(), 0.001 ether);
        assertEq(bridge.admin(), admin);
    }

    function test_TokenRegistration() public view {
        assertEq(bridge.tokenToSolanaMint(address(token)), SOLANA_MINT);
        assertTrue(bridge.isTokenRegistered(address(token)));
    }

    function test_InitiateTransfer() public {
        bytes32 recipient = bytes32(uint256(0x123));
        uint256 amount = 1 ether;
        uint256 fee = bridge.getTransferFee(101, 0);

        vm.deal(user, fee);
        vm.prank(user);
        bytes32 transferId = bridge.initiateTransfer{value: fee}(
            address(token),
            recipient,
            amount,
            101, // Solana chain ID
            ""
        );

        assertTrue(transferId != bytes32(0));
        assertEq(token.balanceOf(address(bridge)), amount);
    }

    function test_RevertWhen_UnregisteredSender() public {
        address unregistered = address(0x999);

        vm.deal(unregistered, 1 ether);
        vm.prank(unregistered);
        vm.expectRevert(ZKBridge.SenderNotRegistered.selector);
        bridge.initiateTransfer{value: 0.01 ether}(address(token), bytes32(uint256(1)), 1 ether, 101, "");
    }

    function test_RevertWhen_BannedSender() public {
        // Get user's agent ID and ban them
        uint256 agentId = identityRegistry.tokenOfOwnerByIndex(user, 0);
        identityRegistry.banAgent(agentId);

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(ZKBridge.SenderBanned.selector);
        bridge.initiateTransfer{value: 0.01 ether}(address(token), bytes32(uint256(1)), 1 ether, 101, "");
    }

    function test_SetFees() public {
        bridge.setFees(0.002 ether, 200 wei);
        assertEq(bridge.baseFee(), 0.002 ether);
        assertEq(bridge.feePerByte(), 200 wei);
    }

    function test_RevertWhen_SetFees_NotAdmin() public {
        vm.prank(user);
        vm.expectRevert(ZKBridge.OnlyAdmin.selector);
        bridge.setFees(0.002 ether, 200 wei);
    }

    function test_Pause() public {
        bridge.pause();
        assertTrue(bridge.paused());

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert();
        bridge.initiateTransfer{value: 0.01 ether}(address(token), bytes32(uint256(1)), 1 ether, 101, "");
    }
}

contract GovernedZKBridgeTest is Test {
    GovernedZKBridge public bridge;
    MockIdentityRegistry public identityRegistry;
    MockSolanaLightClient public lightClient;
    MockZKVerifier public verifier;
    MockCouncil public council;
    MockBridgeToken public token;

    address public guardian = address(0x1234);
    address public user = address(0x5678);

    bytes32 public constant SOLANA_MINT = bytes32(uint256(1));

    function setUp() public {
        identityRegistry = new MockIdentityRegistry();
        lightClient = new MockSolanaLightClient();
        verifier = new MockZKVerifier();
        council = new MockCouncil();
        token = new MockBridgeToken();

        bridge = new GovernedZKBridge(
            address(lightClient),
            address(identityRegistry),
            address(verifier),
            address(council),
            guardian,
            0.001 ether,
            100 wei
        );

        identityRegistry.registerAgent(user, 2);
        token.mint(user, 1000 ether);
    }

    function test_GovernedInit() public view {
        assertEq(address(bridge.council()), address(council));
        assertEq(bridge.guardian(), guardian);
        assertEq(bridge.admin(), address(bridge)); // Self-admin
    }

    function test_RegisterTokenGoverned() public {
        bytes32 proposalId = keccak256("register");

        council.createProposal(proposalId, address(bridge));
        council.approveProposal(proposalId);
        council.completeGrace(proposalId);

        bridge.registerTokenGoverned(proposalId, address(token), SOLANA_MINT, true);

        assertEq(bridge.tokenToSolanaMint(address(token)), SOLANA_MINT);
    }

    function test_RevertWhen_NotApproved() public {
        bytes32 proposalId = keccak256("not-approved");
        council.createProposal(proposalId, address(bridge));

        vm.expectRevert(GovernedZKBridge.NotCouncilApproved.selector);
        bridge.registerTokenGoverned(proposalId, address(token), SOLANA_MINT, true);
    }

    function test_EmergencyPause() public {
        vm.prank(guardian);
        bridge.queueEmergencyPause();

        bytes32 actionHash = keccak256(abi.encodePacked("pause", block.timestamp));

        // Fast forward past timelock
        vm.warp(block.timestamp + 2 hours + 1);

        vm.prank(guardian);
        bridge.executeEmergencyPause(actionHash);

        assertTrue(bridge.paused());
    }

    function test_RevertWhen_EmergencyNotGuardian() public {
        vm.prank(user);
        vm.expectRevert(GovernedZKBridge.NotGuardian.selector);
        bridge.queueEmergencyPause();
    }
}
