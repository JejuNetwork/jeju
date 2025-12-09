// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ComputeOutputSettler} from "../../src/oif/ComputeOutputSettler.sol";
import {
    ComputeRentalOrderData,
    ComputeInferenceOrderData,
    COMPUTE_RENTAL_ORDER_TYPE,
    COMPUTE_INFERENCE_ORDER_TYPE
} from "../../src/oif/IOIF.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock ComputeRental contract - must match createRentalFor signature
contract MockComputeRental {
    event RentalCreated(bytes32 rentalId, address user, address provider);

    receive() external payable {}

    // createRentalFor - used by ComputeOutputSettler
    function createRentalFor(
        address user,
        address provider,
        uint256 durationHours,
        string calldata,
        string calldata,
        string calldata
    ) external payable returns (bytes32) {
        bytes32 rentalId = keccak256(abi.encodePacked(user, provider, durationHours, block.timestamp));
        emit RentalCreated(rentalId, user, provider);
        return rentalId;
    }
}

// Mock ERC20 token
contract MockToken is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }
}

contract ComputeOutputSettlerTest is Test {
    ComputeOutputSettler public settler;
    MockComputeRental public mockRental;
    MockToken public mockToken;

    address public owner;
    address public solver;
    address public user;
    address public provider;

    uint256 constant CHAIN_ID = 420691;

    receive() external payable {}

    function setUp() public {
        owner = address(this);
        solver = makeAddr("solver");
        user = makeAddr("user");
        provider = makeAddr("provider");

        vm.deal(owner, 100 ether);
        vm.deal(solver, 100 ether);
        vm.deal(user, 100 ether);

        mockRental = new MockComputeRental();
        mockToken = new MockToken();

        settler = new ComputeOutputSettler(CHAIN_ID, address(mockRental), address(0), address(0));

        // Setup solver with deposits
        vm.startPrank(solver);
        settler.depositETH{value: 10 ether}();
        mockToken.mint(solver, 1000 ether);
        mockToken.approve(address(settler), type(uint256).max);
        settler.depositLiquidity(address(mockToken), 100 ether);
        vm.stopPrank();
    }

    // ============ Liquidity Tests ============

    function test_depositETH() public {
        vm.prank(user);
        settler.depositETH{value: 1 ether}();
        assertEq(settler.getSolverETH(user), 1 ether);
    }

    function test_depositLiquidity() public {
        mockToken.mint(user, 100 ether);
        vm.startPrank(user);
        mockToken.approve(address(settler), 100 ether);
        settler.depositLiquidity(address(mockToken), 100 ether);
        vm.stopPrank();
        assertEq(settler.getSolverLiquidity(user, address(mockToken)), 100 ether);
    }

    function test_withdrawETH() public {
        vm.startPrank(solver);
        uint256 before = solver.balance;
        settler.withdrawETH(1 ether);
        vm.stopPrank();
        assertEq(solver.balance, before + 1 ether);
        assertEq(settler.getSolverETH(solver), 9 ether);
    }

    function test_withdrawLiquidity() public {
        vm.prank(solver);
        settler.withdrawLiquidity(address(mockToken), 50 ether);
        assertEq(settler.getSolverLiquidity(solver, address(mockToken)), 50 ether);
    }

    function test_withdrawETH_insufficientBalance() public {
        vm.prank(user);
        vm.expectRevert(ComputeOutputSettler.InsufficientLiquidity.selector);
        settler.withdrawETH(1 ether);
    }

    // ============ Compute Rental Fill Tests ============

    function test_fillComputeRental() public {
        bytes32 orderId = keccak256("test-order-1");
        uint256 payment = 0.5 ether;

        ComputeRentalOrderData memory data = ComputeRentalOrderData({
            provider: provider,
            durationHours: 2,
            sshPublicKey: "ssh-rsa AAAA...",
            containerImage: "nvidia/cuda:12.0",
            startupScript: "echo hello"
        });

        vm.prank(solver);
        bytes32 rentalId = settler.fillComputeRental(orderId, data, user, payment);

        assertTrue(settler.isFilled(orderId));
        assertTrue(rentalId != bytes32(0));

        ComputeOutputSettler.FillRecord memory record = settler.getFillRecord(orderId);
        assertEq(record.solver, solver);
        assertEq(record.user, user);
        assertEq(record.rentalId, rentalId);
        assertEq(record.paymentAmount, payment);
        assertTrue(record.isRental);
    }

    function test_fillComputeRental_deductsETH() public {
        bytes32 orderId = keccak256("test-order-2");
        uint256 payment = 1 ether;
        uint256 beforeBalance = settler.getSolverETH(solver);

        ComputeRentalOrderData memory data = ComputeRentalOrderData({
            provider: provider,
            durationHours: 1,
            sshPublicKey: "ssh-rsa BBBB...",
            containerImage: "",
            startupScript: ""
        });

        vm.prank(solver);
        settler.fillComputeRental(orderId, data, user, payment);

        assertEq(settler.getSolverETH(solver), beforeBalance - payment);
    }

    function test_fillComputeRental_alreadyFilled() public {
        bytes32 orderId = keccak256("test-order-3");

        ComputeRentalOrderData memory data = ComputeRentalOrderData({
            provider: provider,
            durationHours: 1,
            sshPublicKey: "ssh-rsa CCCC...",
            containerImage: "",
            startupScript: ""
        });

        vm.prank(solver);
        settler.fillComputeRental(orderId, data, user, 0.1 ether);

        vm.prank(solver);
        vm.expectRevert(ComputeOutputSettler.OrderAlreadyFilled.selector);
        settler.fillComputeRental(orderId, data, user, 0.1 ether);
    }

    function test_fillComputeRental_insufficientLiquidity() public {
        bytes32 orderId = keccak256("test-order-4");

        ComputeRentalOrderData memory data = ComputeRentalOrderData({
            provider: provider,
            durationHours: 1,
            sshPublicKey: "ssh-rsa DDDD...",
            containerImage: "",
            startupScript: ""
        });

        vm.prank(solver);
        vm.expectRevert(ComputeOutputSettler.InsufficientLiquidity.selector);
        settler.fillComputeRental(orderId, data, user, 100 ether);
    }

    function test_fillComputeRental_invalidProvider() public {
        bytes32 orderId = keccak256("test-order-5");

        ComputeRentalOrderData memory data = ComputeRentalOrderData({
            provider: address(0),
            durationHours: 1,
            sshPublicKey: "ssh-rsa EEEE...",
            containerImage: "",
            startupScript: ""
        });

        vm.prank(solver);
        vm.expectRevert(ComputeOutputSettler.InvalidProvider.selector);
        settler.fillComputeRental(orderId, data, user, 0.1 ether);
    }

    // ============ Compute Inference Fill Tests ============

    function test_fillComputeInference() public {
        bytes32 orderId = keccak256("inference-order-1");
        uint256 payment = 0.01 ether;

        ComputeInferenceOrderData memory data = ComputeInferenceOrderData({
            provider: provider,
            model: "llama-3.1-70b",
            prompt: bytes("Hello, world!"),
            maxInputTokens: 100,
            maxOutputTokens: 500
        });

        vm.prank(solver);
        settler.fillComputeInference(orderId, data, user, payment);

        assertTrue(settler.isFilled(orderId));

        ComputeOutputSettler.FillRecord memory record = settler.getFillRecord(orderId);
        assertEq(record.solver, solver);
        assertEq(record.user, user);
        assertFalse(record.isRental);
    }

    // ============ Standard Token Fill Tests ============

    function test_fill_standardETH() public {
        bytes32 orderId = keccak256("token-order-1");
        bytes memory originData = abi.encode(bytes32(0));
        bytes memory fillerData = abi.encode(address(0), 0.5 ether, user, uint256(0));

        vm.prank(solver);
        settler.fill{value: 0}(orderId, originData, fillerData);

        assertTrue(settler.isFilled(orderId));
    }

    function test_fill_standardERC20() public {
        bytes32 orderId = keccak256("token-order-2");
        bytes memory originData = abi.encode(bytes32(0));
        bytes memory fillerData = abi.encode(address(mockToken), 10 ether, user, uint256(0));

        uint256 userBefore = mockToken.balanceOf(user);

        vm.prank(solver);
        settler.fill{value: 0}(orderId, originData, fillerData);

        assertEq(mockToken.balanceOf(user), userBefore + 10 ether);
    }

    // ============ Admin Tests ============

    function test_setComputeContracts() public {
        address newRental = makeAddr("newRental");
        address newInference = makeAddr("newInference");
        settler.setComputeContracts(newRental, newInference, address(0));
        assertEq(settler.computeRental(), newRental);
        assertEq(settler.inferenceServing(), newInference);
    }

    function test_setComputeContracts_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        settler.setComputeContracts(address(0), address(0), address(0));
    }

    // ============ View Tests ============

    function test_version() public view {
        assertEq(settler.version(), "1.0.0");
    }

    function test_chainId() public view {
        assertEq(settler.chainId(), CHAIN_ID);
    }
}
