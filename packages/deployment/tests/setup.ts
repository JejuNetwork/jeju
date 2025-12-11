/**
 * Test Setup Utilities
 *
 * Provides functions to start/stop anvil and deploy contracts for testing.
 * This enables full integration tests without requiring Kurtosis/Docker.
 */

import { spawn, type ChildProcess } from "child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ============ Constants ============

export const TEST_CHAIN_ID = 31337;
export const TEST_RPC_URL = "http://127.0.0.1:8545";

// Anvil default accounts
export const TEST_ACCOUNTS = {
  deployer: {
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
  },
  user1: {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  },
  user2: {
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
  },
} as const;

export const TEST_CHAIN: Chain = {
  id: TEST_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TEST_RPC_URL] } },
};

// ============ Types ============

export interface TestContext {
  anvilProcess: ChildProcess | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
  deployer: ReturnType<typeof privateKeyToAccount>;
  deployedContracts: {
    entryPoint?: Address;
    sponsoredPaymaster?: Address;
    simpleAccountFactory?: Address;
  };
}

// ============ Anvil Management ============

let anvilProcess: ChildProcess | null = null;

export async function startAnvil(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    // Find anvil in path or use foundry installation
    const anvilPath = process.env.ANVIL_PATH || "anvil";

    const proc = spawn(anvilPath, [
      "--host", "127.0.0.1",
      "--port", "8545",
      "--chain-id", TEST_CHAIN_ID.toString(),
      "--gas-limit", "30000000",
      "--code-size-limit", "100000",
      "--accounts", "10",
      "--balance", "10000",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    anvilProcess = proc;

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error("Anvil failed to start within timeout"));
      }
    }, 10000);

    proc.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output.includes("Listening on") && !started) {
        started = true;
        clearTimeout(timeout);
        // Give it a moment to fully initialize
        setTimeout(() => resolve(proc), 500);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      // Anvil sometimes outputs to stderr for info messages
      if (output.includes("Listening on") && !started) {
        started = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(proc), 500);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start anvil: ${err.message}`));
    });

    proc.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Anvil exited with code ${code}`));
      }
    });
  });
}

export async function stopAnvil(): Promise<void> {
  if (anvilProcess) {
    anvilProcess.kill("SIGTERM");
    anvilProcess = null;
    // Wait for process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

export async function isAnvilRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============ Test Context Creation ============

export async function createTestContext(): Promise<TestContext> {
  const deployer = privateKeyToAccount(TEST_ACCOUNTS.deployer.privateKey);

  const publicClient = createPublicClient({
    chain: TEST_CHAIN,
    transport: http(TEST_RPC_URL),
  });

  const walletClient = createWalletClient({
    account: deployer,
    chain: TEST_CHAIN,
    transport: http(TEST_RPC_URL),
  });

  return {
    anvilProcess: null,
    publicClient: publicClient as PublicClient,
    walletClient: walletClient as WalletClient,
    deployer,
    deployedContracts: {},
  };
}

// ============ Contract Deployment ============

// EntryPoint v0.7 bytecode (pre-deployed address check)
export const ENTRYPOINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

// Deploy EntryPoint bytecode to the expected address using anvil's setCode
export async function deployEntryPointMock(ctx: TestContext): Promise<Address> {
  // For testing, we'll use anvil's eth_setCode to mock the EntryPoint
  // This is a simplified mock that just tracks deposits

  const mockEntryPointBytecode = "0x608060405234801561001057600080fd5b506104f7806100206000396000f3fe60806040526004361061004a5760003560e01c806301ffc9a71461004f57806335567e1a1461008f5780635287ce12146100bf57806370a08231146100df578063b760faf914610112575b600080fd5b34801561005b57600080fd5b5061007a61006a36600461038b565b6001600160e01b0319161590565b60405190151581526020015b60405180910390f35b34801561009b57600080fd5b506100af6100aa3660046103b4565b610125565b6040519081526020016100865760003560e01c156100865760003560e01c63b760faf9149050565b6100af6100cd3660046103e4565b60006020819052908152604090205481565b3480156100eb57600080fd5b506100af6100fa3660046103e4565b6001600160a01b031660009081526020819052604090205490565b610123610120366004610401565b90565b005b6001600160a01b038216600090815260016020908152604080832084845290915290205492915050565b610120610157366004610401565b6001600160a01b0381166000908152602081905260408120805434929061017f908490610433565b909155505050565b600060208284031215610019898989898989898989898989610199576000fd5b60006020828403121561019b57600080fd5b81356001600160e01b0319811681146101b357600080fd5b9392505050565b600080604083850312156101cd57600080fd5b82356001600160a01b03811681146101e457600080fd5b946020939093013593505050565b60006020828403121561020457600080fd5b81356001600160a01b03811681146101b357600080fd5b60006020828403121561022d57600080fd5b5035919050565b6000806000806080858703121561024a57600080fd5b843593506020850135925060408501359150606085013590509295919450925050565b634e487b7160e01b600052601160045260246000fd5b8082018082111561029657610296610270565b9291505056fea264697066735822";

  await fetch(TEST_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_setCode",
      params: [ENTRYPOINT_V07_ADDRESS, mockEntryPointBytecode],
      id: 1,
    }),
  });

  ctx.deployedContracts.entryPoint = ENTRYPOINT_V07_ADDRESS;
  return ENTRYPOINT_V07_ADDRESS;
}

// ============ Utility Functions ============

export async function waitForBlock(client: PublicClient, blockNumber?: bigint): Promise<void> {
  const target = blockNumber ?? (await client.getBlockNumber()) + 1n;
  while ((await client.getBlockNumber()) < target) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function mineBlock(count: number = 1): Promise<void> {
  await fetch(TEST_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_mine",
      params: [count],
      id: 1,
    }),
  });
}

export async function setBalance(address: Address, balance: bigint): Promise<void> {
  await fetch(TEST_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_setBalance",
      params: [address, `0x${balance.toString(16)}`],
      id: 1,
    }),
  });
}

// ============ Full Test Setup/Teardown ============

export async function setupTestEnvironment(): Promise<TestContext> {
  console.log("🔧 Setting up test environment...");

  // Check if anvil is already running
  const alreadyRunning = await isAnvilRunning();

  let proc: ChildProcess | null = null;
  if (!alreadyRunning) {
    console.log("   Starting anvil...");
    proc = await startAnvil();
    console.log("   ✅ Anvil started");
  } else {
    console.log("   ✅ Using existing anvil instance");
  }

  const ctx = await createTestContext();
  ctx.anvilProcess = proc;

  // Deploy mock EntryPoint
  console.log("   Deploying mock EntryPoint...");
  await deployEntryPointMock(ctx);
  console.log("   ✅ EntryPoint deployed at", ENTRYPOINT_V07_ADDRESS);

  console.log("✅ Test environment ready\n");
  return ctx;
}

export async function teardownTestEnvironment(ctx: TestContext): Promise<void> {
  console.log("\n🧹 Tearing down test environment...");

  if (ctx.anvilProcess) {
    await stopAnvil();
    console.log("   ✅ Anvil stopped");
  }

  console.log("✅ Cleanup complete\n");
}
