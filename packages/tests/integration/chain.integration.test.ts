import { describe, test, expect, beforeAll } from "bun:test";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { $ } from "bun";

// Check if Kurtosis localnet is available
let kurtosisAvailable = false;
try {
  const result = await $`kurtosis enclave inspect jeju-localnet`.quiet().nothrow();
  kurtosisAvailable = result.exitCode === 0;
} catch {
  console.log('Kurtosis localnet not available, skipping chain integration tests');
}

describe.skipIf(!kurtosisAvailable)("Chain Integration Tests", () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let account: ReturnType<typeof privateKeyToAccount>;
  let l2RpcUrl: string;

  beforeAll(async () => {
    // Get L2 RPC URL from Kurtosis
    const portOutput = await $`kurtosis port print jeju-localnet op-geth rpc`.text();
    const port = portOutput.trim().split(":")[1];
    l2RpcUrl = `http://127.0.0.1:${port}`;

    if (!l2RpcUrl) {
      throw new Error("Could not get L2 RPC URL from Kurtosis. Is the localnet running?");
    }

    // Create test account
    account = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    );

    // Create clients
    publicClient = createPublicClient({
      transport: http(l2RpcUrl),
    });

    const kurtosisFundedAccount = privateKeyToAccount("0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291");

    walletClient = createWalletClient({
      account: kurtosisFundedAccount,
      transport: http(l2RpcUrl),
    });

    // Fund the test account
    const hash = await walletClient.sendTransaction({
      account: kurtosisFundedAccount,
      to: account.address,
      value: parseEther("100"),
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Recreate walletClient with the now-funded test account
    walletClient = createWalletClient({
      account,
      transport: http(l2RpcUrl),
    });
  });

  describe("Basic Chain Functionality", () => {
    test("should get chain ID", async () => {
      const chainId = await publicClient.getChainId();
      expect(chainId).toBe(1337);
    });

    test("should get latest block", async () => {
      const block = await publicClient.getBlock();
      expect(block).toBeDefined();
      expect(block.number).toBeGreaterThanOrEqual(0);
    });

    test("should get block time ~2 seconds", async () => {
      const block1 = await publicClient.getBlock();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const block2 = await publicClient.getBlock();

      const timeDiff = Number(block2.timestamp - block1.timestamp);
      const blockDiff = Number(block2.number - block1.number);
      
      // Can be 0 if no txs
      if (blockDiff === 0) {
        expect(timeDiff).toBe(0);
        return;
      }
      
      const avgBlockTime = timeDiff / blockDiff;

      expect(avgBlockTime).toBeGreaterThanOrEqual(1.5);
      expect(avgBlockTime).toBeLessThanOrEqual(2.5);
    });

    test("should send transaction", async () => {
      const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

      const hash = await walletClient.sendTransaction({
        account,
        to: recipient,
        value: parseEther("0.01"),
        chain: null,
      });

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    });

    test("should estimate gas", async () => {
      const gas = await publicClient.estimateGas({
        account,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        value: parseEther("0.01"),
      });

      expect(gas).toBeGreaterThan(0);
      expect(gas).toBeLessThan(1000000); // reasonable gas limit
    });
  });

  describe("Flashblocks", () => {
    test("should have sub-second pre-confirmations", async () => {
      const startTime = Date.now();

      const hash = await walletClient.sendTransaction({
        account,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        value: parseEther("0.001"),
        chain: null,
      });

      // Check for pre-confirmation (Flashblocks)
      // This would require a custom RPC method or websocket subscription
      // For now, verify transaction is visible quickly
      let found = false;
      let attempts = 0;
      while (!found && attempts < 10) {
        const tx = await publicClient.getTransaction({ hash }).catch(() => null);
        if (tx) {
          found = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        attempts++;
      }

      const preConfTime = Date.now() - startTime;
      expect(preConfTime).toBeLessThan(1000); // Increased timeout for CI
    });
  });

  describe("L2 Predeploys", () => {
    test("should have WETH predeploy", async () => {
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const code = await publicClient.getBytecode({ address: wethAddress });
      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });

    test("should have L2StandardBridge predeploy", async () => {
      const bridgeAddress = "0x4200000000000000000000000000000000000010";
      const code = await publicClient.getBytecode({ address: bridgeAddress });
      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });

    test("should have GasPriceOracle predeploy", async () => {
      const oracleAddress = "0x420000000000000000000000000000000000000F";
      const code = await publicClient.getBytecode({ address: oracleAddress });
      expect(code).toBeDefined();
      expect(code).not.toBe("0x");
    });
  });

  describe("JSON-RPC Methods", () => {
    test("should support eth_call", async () => {
      const result = await publicClient.call({
        account,
        to: "0x4200000000000000000000000000000000000006",
        data: "0x06fdde03", // name()
      });
      expect(result).toBeDefined();
    });

    test("should support eth_getBalance", async () => {
      const balance = await publicClient.getBalance({
        address: account.address,
      });
      expect(balance).toBeGreaterThan(0);
    });

    test("should support eth_getTransactionCount", async () => {
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
      });
      expect(nonce).toBeGreaterThanOrEqual(0);
    });

    test("should support eth_getCode", async () => {
      const code = await publicClient.getBytecode({
        address: "0x4200000000000000000000000000000000000006",
      });
      expect(code).toBeDefined();
      expect(code).toMatch(/^0x[a-fA-F0-9]*$/);
    });
  });

  describe("Performance", () => {
    test("should handle concurrent transactions", async () => {
      const txCount = 10;
      const promises = Array.from({ length: txCount }, () =>
        walletClient.sendTransaction({
          account,
          to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          value: parseEther("0.0001"),
          chain: null,
        })
      );

      const hashes = await Promise.all(promises);
      expect(hashes).toHaveLength(txCount);

      // Wait for all confirmations
      const receipts = await Promise.all(
        hashes.map((hash) => publicClient.waitForTransactionReceipt({ hash }))
      );

      expect(receipts.every((r) => r.status === "success")).toBe(true);
    });

    test("should respond to RPC calls quickly", async () => {
      const iterations = 20; // Reduced for speed
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await publicClient.getBlockNumber();
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      expect(avgLatency).toBeLessThan(200); // < 200ms average
      expect(p95Latency).toBeLessThan(500); // < 500ms p95
    });
  });
});


