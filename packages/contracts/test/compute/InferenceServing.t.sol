// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/compute/InferenceServing.sol";
import "../../src/compute/ComputeRegistry.sol";
import "../../src/compute/LedgerManager.sol";

contract InferenceServingTest is Test {
    InferenceServing public inference;
    ComputeRegistry public registry;
    LedgerManager public ledger;

    address public owner;
    address public provider1;
    address public user1;
    uint256 public provider1Key;

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        (provider1, provider1Key) = makeAddrAndKey("provider1");

        vm.deal(user1, 10 ether);
        vm.deal(provider1, 10 ether);

        // Deploy contracts
        registry = new ComputeRegistry(owner);
        ledger = new LedgerManager(address(registry), owner);
        inference = new InferenceServing(address(registry), address(ledger), owner);

        // Setup ledger to work with inference
        ledger.setInferenceContract(address(inference));

        // Register provider
        vm.prank(provider1);
        registry.register{value: 0.1 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));
    }

    function test_RegisterService() public {
        vm.startPrank(provider1);

        inference.registerService(
            "llama-3.1-8b",
            "https://api.test.com/v1",
            1e9, // 1 gwei per input token
            2e9 // 2 gwei per output token
        );

        InferenceServing.Service[] memory services = inference.getServices(provider1);
        assertEq(services.length, 1);
        assertEq(services[0].model, "llama-3.1-8b");
        assertEq(services[0].pricePerInputToken, 1e9);
        assertEq(services[0].pricePerOutputToken, 2e9);
        assertTrue(services[0].active);

        vm.stopPrank();
    }

    function test_DeactivateService() public {
        vm.startPrank(provider1);

        inference.registerService("llama-3.1-8b", "https://api.test.com/v1", 1e9, 2e9);
        inference.deactivateService(0);

        InferenceServing.Service[] memory services = inference.getServices(provider1);
        assertFalse(services[0].active);

        vm.stopPrank();
    }

    function test_SetSigner() public {
        address customSigner = makeAddr("customSigner");

        vm.prank(provider1);
        inference.setSigner(customSigner);

        assertEq(inference.getSigner(provider1), customSigner);
    }

    function test_Settle() public {
        // Register service
        vm.prank(provider1);
        inference.registerService("llama-3.1-8b", "https://api.test.com/v1", 1e9, 2e9);

        // User creates ledger and deposits
        vm.prank(user1);
        ledger.createLedger{value: 1 ether}();

        vm.prank(user1);
        ledger.transferToProvider(provider1, 0.5 ether);

        vm.prank(provider1);
        ledger.acknowledgeUser(user1);

        // Create signature
        bytes32 requestHash = bytes32(uint256(12345));
        uint256 inputTokens = 100;
        uint256 outputTokens = 50;
        uint256 nonce = inference.getNonce(user1, provider1);

        bytes32 messageHash =
            keccak256(abi.encodePacked(user1, provider1, requestHash, inputTokens, outputTokens, nonce));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(provider1Key, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Settle
        uint256 providerBalanceBefore = provider1.balance;

        vm.prank(user1);
        inference.settle(provider1, requestHash, inputTokens, outputTokens, nonce, signature);

        uint256 providerBalanceAfter = provider1.balance;
        uint256 expectedFee = (inputTokens * 1e9) + (outputTokens * 2e9);
        assertEq(providerBalanceAfter - providerBalanceBefore, expectedFee);

        // Verify nonce incremented
        assertEq(inference.getNonce(user1, provider1), nonce + 1);
    }

    function test_CalculateFee() public {
        vm.prank(provider1);
        inference.registerService("llama-3.1-8b", "https://api.test.com/v1", 1e9, 2e9);

        uint256 fee = inference.calculateFee(provider1, 100, 50);
        assertEq(fee, (100 * 1e9) + (50 * 2e9));
    }

    function test_Version() public view {
        assertEq(inference.version(), "1.0.0");
    }
}
