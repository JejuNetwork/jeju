// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/stage2/ThresholdBatchSubmitter.sol";

contract MockBatchInbox {
    bytes[] public batches;
    
    fallback() external payable {
        batches.push(msg.data);
    }
    
    function getBatchCount() external view returns (uint256) {
        return batches.length;
    }
}

contract TestThresholdSubmitter is Script {
    uint256 constant SEQ1_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant SEQ2_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    
    function run() external {
        vm.startBroadcast(SEQ1_KEY);
        
        // Deploy
        MockBatchInbox inbox = new MockBatchInbox();
        ThresholdBatchSubmitter submitter = new ThresholdBatchSubmitter(
            address(inbox),
            vm.addr(SEQ1_KEY),
            2
        );
        
        // Add sequencers
        submitter.addSequencer(vm.addr(SEQ1_KEY));
        submitter.addSequencer(vm.addr(SEQ2_KEY));
        
        console.log("Submitter deployed:", address(submitter));
        console.log("Sequencer count:", submitter.sequencerCount());
        console.log("Threshold:", submitter.threshold());
        
        vm.stopBroadcast();
        
        // Sign and submit
        bytes memory batchData = hex"deadbeef";
        bytes32 digest = submitter.getBatchDigest(batchData);
        console.log("Digest:");
        console.logBytes32(digest);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SEQ1_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SEQ2_KEY, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        address[] memory signers = new address[](2);
        signers[0] = vm.addr(SEQ1_KEY);
        signers[1] = vm.addr(SEQ2_KEY);
        
        console.log("Signer 1:", signers[0]);
        console.log("Signer 2:", signers[1]);
        
        vm.startBroadcast(SEQ1_KEY);
        
        uint256 nonceBefore = submitter.nonce();
        console.log("Nonce before:", nonceBefore);
        
        submitter.submitBatch(batchData, signatures, signers);
        
        uint256 nonceAfter = submitter.nonce();
        console.log("Nonce after:", nonceAfter);
        
        require(nonceAfter == nonceBefore + 1, "Nonce did not increment");
        require(inbox.getBatchCount() == 1, "Batch not received");
        
        console.log("SUCCESS: Batch submitted with threshold signatures!");
        
        vm.stopBroadcast();
    }
}

