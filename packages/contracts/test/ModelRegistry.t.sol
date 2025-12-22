// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

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
            BaseArtifactRegistry.Visibility.PUBLIC,
            "LLaMA 3 fine-tuned on Jeju documentation",
            tags
        );
        
        vm.stopPrank();
        
        // Verify model was created
        ModelRegistry.FullModel memory model = modelRegistry.getModel(modelId);
        assertEq(model.artifact.name, "llama-3-jeju");
        assertEq(model.artifact.namespace, "jeju-labs");
        assertEq(model.artifact.owner, creator);
        assertEq(uint8(model.metadata.modelType), uint8(ModelRegistry.ModelType.LLM));
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
        BaseArtifactRegistry.ArtifactVersion[] memory artifactVersions = modelRegistry.getVersions(modelId);
        assertEq(artifactVersions.length, 1);
        assertEq(artifactVersions[0].version, "1.0.0");
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
        modelRegistry.recordDownload(modelId);
        
        // Verify download count via getModel
        ModelRegistry.FullModel memory model = modelRegistry.getModel(modelId);
        assertEq(model.artifact.downloadCount, 1);
    }
    
    function test_StarModel() public {
        bytes32 modelId = _createTestModel();
        
        // Star as user
        vm.prank(user);
        modelRegistry.toggleStar(modelId);
        
        ModelRegistry.FullModel memory model = modelRegistry.getModel(modelId);
        assertEq(model.artifact.starCount, 1);
        
        // Unstar
        vm.prank(user);
        modelRegistry.toggleStar(modelId);
        
        model = modelRegistry.getModel(modelId);
        assertEq(model.artifact.starCount, 0);
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
            BaseArtifactRegistry.Visibility.PUBLIC,
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
            BaseArtifactRegistry.Visibility.PUBLIC,
            "Second model",
            tags2
        );
        
        vm.stopPrank();
        
        // Verify both models created
        ModelRegistry.FullModel memory model1 = modelRegistry.getModel(modelId1);
        ModelRegistry.FullModel memory model2 = modelRegistry.getModel(modelId2);
        
        assertEq(model1.artifact.name, "model-1");
        assertEq(model2.artifact.name, "model-2");
        assertEq(uint8(model1.metadata.modelType), uint8(ModelRegistry.ModelType.LLM));
        assertEq(uint8(model2.metadata.modelType), uint8(ModelRegistry.ModelType.VISION));
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
            BaseArtifactRegistry.Visibility.PUBLIC,
            "A test model",
            tags
        );
        
        vm.stopPrank();
        
        return modelId;
    }
}
