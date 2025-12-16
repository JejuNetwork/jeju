// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/models/ModelRegistry.sol";
import "../src/registry/IdentityRegistry.sol";

contract ModelRegistryTest is Test {
    ModelRegistry public modelRegistry;
    IdentityRegistry public identityRegistry;
    
    address public owner = address(1);
    address public creator = address(2);
    address public user = address(3);
    address public treasury = address(4);
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy IdentityRegistry
        identityRegistry = new IdentityRegistry();
        
        // Deploy ModelRegistry
        modelRegistry = new ModelRegistry(
            address(identityRegistry),
            treasury,
            owner
        );
        
        vm.stopPrank();
        
        vm.deal(creator, 10 ether);
        vm.deal(user, 1 ether);
    }
    
    function test_CreateModel() public {
        vm.startPrank(creator);
        
        string[] memory tags = new string[](3);
        tags[0] = "llm";
        tags[1] = "fine-tuned";
        tags[2] = "code";
        
        bytes32 modelId = modelRegistry.createModel(
            "llama-3-jeju",
            "jeju-labs",
            ModelRegistry.ModelType.LLM,
            ModelRegistry.LicenseType.MIT,
            "",
            ModelRegistry.AccessLevel.PUBLIC,
            "LLaMA 3 fine-tuned on Jeju documentation",
            tags
        );
        
        vm.stopPrank();
        
        // Verify model was created
        ModelRegistry.Model memory model = modelRegistry.getModel(modelId);
        assertEq(model.name, "llama-3-jeju");
        assertEq(model.organization, "jeju-labs");
        assertEq(model.owner, creator);
        assertEq(uint8(model.modelType), uint8(ModelRegistry.ModelType.LLM));
    }
    
    function test_PublishVersion() public {
        bytes32 modelId = _createTestModel();
        
        vm.startPrank(creator);
        
        bytes32 versionId = modelRegistry.publishVersion(
            modelId,
            "1.0.0",
            "ipfs://model-weights...",
            keccak256("weights"),
            1000000,
            "ipfs://config...",
            "ipfs://tokenizer...",
            8000000000, // 8B params
            "fp16"
        );
        
        vm.stopPrank();
        
        // Verify version was created
        assertTrue(versionId != bytes32(0));
        
        // Get versions
        ModelRegistry.ModelVersion[] memory versions = modelRegistry.getModelVersions(modelId);
        assertEq(versions.length, 1);
        assertEq(versions[0].version, "1.0.0");
    }
    
    function test_DownloadModel() public {
        bytes32 modelId = _createTestModel();
        
        // Add a version first
        vm.prank(creator);
        modelRegistry.publishVersion(
            modelId,
            "1.0.0",
            "ipfs://weights...",
            keccak256("weights"),
            500000,
            "ipfs://config...",
            "",
            1000000000,
            "fp32"
        );
        
        // Download as user
        vm.prank(user);
        modelRegistry.downloadModel(modelId);
        
        // Verify download count via metrics
        ModelRegistry.ModelMetrics memory modelMetrics = modelRegistry.getMetrics(modelId);
        assertEq(modelMetrics.totalDownloads, 1);
    }
    
    function test_StarModel() public {
        bytes32 modelId = _createTestModel();
        
        // Star as user
        vm.prank(user);
        modelRegistry.toggleStar(modelId);
        
        ModelRegistry.ModelMetrics memory modelMetrics = modelRegistry.getMetrics(modelId);
        assertEq(modelMetrics.totalStars, 1);
        
        // Unstar
        vm.prank(user);
        modelRegistry.toggleStar(modelId);
        
        modelMetrics = modelRegistry.getMetrics(modelId);
        assertEq(modelMetrics.totalStars, 0);
    }
    
    function test_CreateMultipleModels() public {
        // Create multiple models
        vm.startPrank(creator);
        
        string[] memory tags1 = new string[](1);
        tags1[0] = "llm";
        bytes32 modelId1 = modelRegistry.createModel(
            "model-1",
            "org1",
            ModelRegistry.ModelType.LLM,
            ModelRegistry.LicenseType.MIT,
            "",
            ModelRegistry.AccessLevel.PUBLIC,
            "First model",
            tags1
        );
        
        string[] memory tags2 = new string[](1);
        tags2[0] = "vision";
        bytes32 modelId2 = modelRegistry.createModel(
            "model-2",
            "org1",
            ModelRegistry.ModelType.VISION,
            ModelRegistry.LicenseType.APACHE_2,
            "",
            ModelRegistry.AccessLevel.PUBLIC,
            "Second model",
            tags2
        );
        
        vm.stopPrank();
        
        // Verify both models created
        ModelRegistry.Model memory model1 = modelRegistry.getModel(modelId1);
        ModelRegistry.Model memory model2 = modelRegistry.getModel(modelId2);
        
        assertEq(model1.name, "model-1");
        assertEq(model2.name, "model-2");
        assertEq(uint8(model1.modelType), uint8(ModelRegistry.ModelType.LLM));
        assertEq(uint8(model2.modelType), uint8(ModelRegistry.ModelType.VISION));
    }

    // Helper function
    function _createTestModel() internal returns (bytes32) {
        vm.startPrank(creator);
        
        string[] memory tags = new string[](1);
        tags[0] = "test";
        
        bytes32 modelId = modelRegistry.createModel(
            "test-model",
            "test-org",
            ModelRegistry.ModelType.LLM,
            ModelRegistry.LicenseType.MIT,
            "",
            ModelRegistry.AccessLevel.PUBLIC,
            "A test model",
            tags
        );
        
        vm.stopPrank();
        
        return modelId;
    }
}
