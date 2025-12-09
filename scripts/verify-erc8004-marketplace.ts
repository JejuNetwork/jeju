#!/usr/bin/env bun
/**
 * ERC-8004 Marketplace Integration Verification
 * 
 * Tests all marketplace functions on the deployed IdentityRegistry contract:
 * - Register agent with tags
 * - Set A2A/MCP endpoints
 * - Set service type, category, x402 support
 * - Get marketplace info
 * - Get active agents
 */

import { ethers } from "ethers";

const IDENTITY_REGISTRY_ADDRESS = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
const RPC_URL = "http://127.0.0.1:8545";

// Anvil default account #0
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Helper to avoid nonce issues
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const IDENTITY_REGISTRY_ABI = [
  // Registration
  "function register(string tokenURI_) external returns (uint256 agentId)",
  "function register(string tokenURI_, (string key, bytes value)[] metadata) external returns (uint256 agentId)",
  "function updateTags(uint256 agentId, string[] tags_) external",
  
  // Marketplace functions
  "function setA2AEndpoint(uint256 agentId, string endpoint) external",
  "function setMCPEndpoint(uint256 agentId, string endpoint) external",
  "function setEndpoints(uint256 agentId, string a2aEndpoint, string mcpEndpoint) external",
  "function setServiceType(uint256 agentId, string serviceType) external",
  "function setCategory(uint256 agentId, string category) external",
  "function setX402Support(uint256 agentId, bool supported) external",
  
  // Getters
  "function getA2AEndpoint(uint256 agentId) external view returns (string)",
  "function getMCPEndpoint(uint256 agentId) external view returns (string)",
  "function getServiceType(uint256 agentId) external view returns (string)",
  "function getCategory(uint256 agentId) external view returns (string)",
  "function getX402Support(uint256 agentId) external view returns (bool)",
  "function getMarketplaceInfo(uint256 agentId) external view returns (string a2aEndpoint, string mcpEndpoint, string serviceType, string category, bool x402Supported, uint8 tier, bool banned)",
  "function getActiveAgents(uint256 offset, uint256 limit) external view returns (uint256[])",
  "function getAgentTags(uint256 agentId) external view returns (string[])",
  "function getAgentsByTag(string tag) external view returns (uint256[])",
  "function totalAgents() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  
  // Events
  "event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)",
  "event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value)",
  "event TagsUpdated(uint256 indexed agentId, string[] tags)",
];

async function main() {
  console.log("=".repeat(60));
  console.log("ERC-8004 Marketplace Integration Verification");
  console.log("=".repeat(60));
  console.log("");

  // Connect to the local chain
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const registry = new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, wallet);

  console.log("Connected to:", RPC_URL);
  console.log("Registry:", IDENTITY_REGISTRY_ADDRESS);
  console.log("Wallet:", wallet.address);
  console.log("");

  // Test 1: Register a new agent
  console.log("[Test 1] Registering a new agent...");
  const tokenURI = "https://example.com/.well-known/agent-card.json";
  const tx1 = await registry["register(string)"](tokenURI);
  const receipt1 = await tx1.wait();
  
  // Find the agentId from the event
  const registeredEvent = receipt1.logs.find((log: ethers.Log) => {
    try {
      const parsed = registry.interface.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === "Registered";
    } catch {
      return false;
    }
  });
  
  const agentId = registeredEvent ? BigInt(registeredEvent.topics[1]) : 1n;
  console.log("  Registered agent ID:", agentId.toString());
  console.log("  TX:", tx1.hash);
  console.log("");
  await delay(500);

  // Test 2: Update tags
  console.log("[Test 2] Updating agent tags...");
  const tags = ["ai", "chat", "defi", "marketplace"];
  const tx2 = await registry.updateTags(agentId, tags);
  await tx2.wait();
  const storedTags = await registry.getAgentTags(agentId);
  console.log("  Tags set:", tags.join(", "));
  console.log("  Tags retrieved:", storedTags.join(", "));
  console.log("  TX:", tx2.hash);
  if (JSON.stringify(storedTags) !== JSON.stringify(tags)) {
    throw new Error("Tags mismatch");
  }
  console.log("  PASS: Tags match");
  console.log("");
  await delay(500);

  // Test 3: Set A2A endpoint
  console.log("[Test 3] Setting A2A endpoint...");
  const a2aEndpoint = "https://example.com/api/a2a";
  const tx3 = await registry.setA2AEndpoint(agentId, a2aEndpoint);
  await tx3.wait();
  const storedA2A = await registry.getA2AEndpoint(agentId);
  console.log("  A2A endpoint set:", a2aEndpoint);
  console.log("  A2A endpoint retrieved:", storedA2A);
  console.log("  TX:", tx3.hash);
  if (storedA2A !== a2aEndpoint) {
    throw new Error("A2A endpoint mismatch");
  }
  console.log("  PASS: A2A endpoint matches");
  console.log("");
  await delay(500);

  // Test 4: Set MCP endpoint
  console.log("[Test 4] Setting MCP endpoint...");
  const mcpEndpoint = "https://example.com/api/mcp";
  const tx4 = await registry.setMCPEndpoint(agentId, mcpEndpoint);
  await tx4.wait();
  const storedMCP = await registry.getMCPEndpoint(agentId);
  console.log("  MCP endpoint set:", mcpEndpoint);
  console.log("  MCP endpoint retrieved:", storedMCP);
  console.log("  TX:", tx4.hash);
  if (storedMCP !== mcpEndpoint) {
    throw new Error("MCP endpoint mismatch");
  }
  console.log("  PASS: MCP endpoint matches");
  console.log("");
  await delay(500);

  // Test 5: Set service type
  console.log("[Test 5] Setting service type...");
  const serviceType = "mcp";
  const tx5 = await registry.setServiceType(agentId, serviceType);
  await tx5.wait();
  const storedType = await registry.getServiceType(agentId);
  console.log("  Service type set:", serviceType);
  console.log("  Service type retrieved:", storedType);
  console.log("  TX:", tx5.hash);
  if (storedType !== serviceType) {
    throw new Error("Service type mismatch");
  }
  console.log("  PASS: Service type matches");
  console.log("");
  await delay(500);

  // Test 6: Set category
  console.log("[Test 6] Setting category...");
  const category = "defi";
  const tx6 = await registry.setCategory(agentId, category);
  await tx6.wait();
  const storedCategory = await registry.getCategory(agentId);
  console.log("  Category set:", category);
  console.log("  Category retrieved:", storedCategory);
  console.log("  TX:", tx6.hash);
  if (storedCategory !== category) {
    throw new Error("Category mismatch");
  }
  console.log("  PASS: Category matches");
  console.log("");
  await delay(500);

  // Test 7: Set x402 support
  console.log("[Test 7] Setting x402 support...");
  const tx7 = await registry.setX402Support(agentId, true);
  await tx7.wait();
  const storedX402 = await registry.getX402Support(agentId);
  console.log("  x402 support set:", true);
  console.log("  x402 support retrieved:", storedX402);
  console.log("  TX:", tx7.hash);
  if (storedX402 !== true) {
    throw new Error("x402 support mismatch");
  }
  console.log("  PASS: x402 support matches");
  console.log("");
  await delay(500);

  // Test 8: Get marketplace info (batch getter)
  console.log("[Test 8] Getting marketplace info (batch)...");
  const marketplaceInfo = await registry.getMarketplaceInfo(agentId);
  console.log("  Marketplace Info:");
  console.log("    a2aEndpoint:", marketplaceInfo.a2aEndpoint);
  console.log("    mcpEndpoint:", marketplaceInfo.mcpEndpoint);
  console.log("    serviceType:", marketplaceInfo.serviceType);
  console.log("    category:", marketplaceInfo.category);
  console.log("    x402Supported:", marketplaceInfo.x402Supported);
  console.log("    tier:", marketplaceInfo.tier);
  console.log("    banned:", marketplaceInfo.banned);
  
  if (marketplaceInfo.a2aEndpoint !== a2aEndpoint) throw new Error("Batch a2aEndpoint mismatch");
  if (marketplaceInfo.mcpEndpoint !== mcpEndpoint) throw new Error("Batch mcpEndpoint mismatch");
  if (marketplaceInfo.serviceType !== serviceType) throw new Error("Batch serviceType mismatch");
  if (marketplaceInfo.category !== category) throw new Error("Batch category mismatch");
  if (marketplaceInfo.x402Supported !== true) throw new Error("Batch x402Supported mismatch");
  console.log("  PASS: All batch fields match");
  console.log("");

  // Test 9: Get active agents
  console.log("[Test 9] Getting active agents...");
  const activeAgents = await registry.getActiveAgents(0, 100);
  console.log("  Active agents count:", activeAgents.length);
  console.log("  Active agents:", activeAgents.map((id: bigint) => id.toString()).join(", "));
  const containsAgent = activeAgents.some((id: bigint) => id === agentId);
  if (!containsAgent) {
    throw new Error("Agent not found in active agents list");
  }
  console.log("  PASS: Agent found in active agents list");
  console.log("");

  // Test 10: Get agents by tag
  console.log("[Test 10] Getting agents by tag...");
  const agentsByTag = await registry.getAgentsByTag("defi");
  console.log("  Agents with 'defi' tag:", agentsByTag.map((id: bigint) => id.toString()).join(", "));
  const foundByTag = agentsByTag.some((id: bigint) => id === agentId);
  if (!foundByTag) {
    throw new Error("Agent not found by tag search");
  }
  console.log("  PASS: Agent found by tag search");
  console.log("");
  await delay(500);

  // Register second agent to test pagination
  console.log("[Test 11] Registering second agent for pagination test...");
  const tx11 = await registry["register(string)"]("https://example.com/agent2.json");
  await tx11.wait();
  console.log("  TX:", tx11.hash);
  
  const totalAgents = await registry.totalAgents();
  console.log("  Total agents now:", totalAgents.toString());
  console.log("");
  await delay(500);

  // Test pagination
  console.log("[Test 12] Testing pagination...");
  const page1 = await registry.getActiveAgents(0, 1);
  const page2 = await registry.getActiveAgents(1, 1);
  console.log("  Page 1 (offset=0, limit=1):", page1.map((id: bigint) => id.toString()).join(", "));
  console.log("  Page 2 (offset=1, limit=1):", page2.map((id: bigint) => id.toString()).join(", "));
  if (page1.length !== 1 || page2.length !== 1) {
    throw new Error("Pagination not working correctly");
  }
  console.log("  PASS: Pagination works");
  console.log("");

  // Summary
  console.log("=".repeat(60));
  console.log("ALL TESTS PASSED");
  console.log("=".repeat(60));
  console.log("");
  console.log("Verified functionality:");
  console.log("  - Agent registration with tokenURI");
  console.log("  - Tag updates and retrieval");
  console.log("  - A2A endpoint set/get");
  console.log("  - MCP endpoint set/get");
  console.log("  - Service type set/get");
  console.log("  - Category set/get");
  console.log("  - x402 support set/get");
  console.log("  - Batch marketplace info getter");
  console.log("  - Active agents list with pagination");
  console.log("  - Tag-based agent search");
  console.log("");
  console.log("Registry address:", IDENTITY_REGISTRY_ADDRESS);
  console.log("Test agent ID:", agentId.toString());
  console.log("");
}

main().catch((error) => {
  console.error("");
  console.error("TEST FAILED:", error.message);
  console.error(error);
  process.exit(1);
});

