/**
 * EIL End-to-End Integration Test
 * 
 * Tests the complete EIL flow on deployed localnet contracts:
 * 1. XLP registers on L1
 * 2. XLP deposits liquidity on L2
 * 3. User creates voucher request
 * 4. XLP issues voucher
 * 5. Voucher is fulfilled (simulated)
 * 6. XLP claims source funds
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseAbi, readContract, waitForTransactionReceipt, getLogs, decodeEventLog, parseEther, keccak256, encodePacked, zeroAddress, getBalance, type Address } from 'viem';
import { privateKeyToAccount, signMessage as signMsg } from 'viem/accounts';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Skip if no localnet running
const L1_RPC = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
const L2_RPC = process.env.L2_RPC_URL || 'http://127.0.0.1:9545';

// Load EIL config from JSON files directly to avoid module resolution issues
function loadEilConfig(): { l1StakeManager: string; crossChainPaymaster: string; entryPoint: string } | null {
  const paths = [
    resolve(process.cwd(), 'packages/config/eil.json'),
    resolve(process.cwd(), '../../packages/config/eil.json'),
    resolve(process.cwd(), '../config/eil.json'),
  ];
  
  for (const path of paths) {
    if (existsSync(path)) {
      const config = JSON.parse(readFileSync(path, 'utf-8'));
      const localnet = config.localnet || config;
      return {
        l1StakeManager: localnet.l1StakeManager || '',
        crossChainPaymaster: localnet.crossChainPaymaster || '',
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      };
    }
  }
  return null;
}

// EIL contracts from config
interface EILConfig {
  l1StakeManager: string;
  crossChainPaymaster: string;
  entryPoint: string;
}

// Test accounts (from Anvil)
const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_KEY_1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
// Deployer key for owner-only functions
const DEPLOYER_KEY = '0x805ab516daae3f0871237da6fcc3db33416e515d700a5d470469215b75f3696e';

// Contract ABIs
const L1_STAKE_MANAGER_ABI = [
  'function register(uint256[] memory chainIds) external payable',
  'function getStake(address xlp) external view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, bool isActive, uint256[] supportedChains))',
  'function isXLPActive(address xlp) external view returns (bool)'
];

const PAYMASTER_ABI = [
  'function createVoucherRequest(address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement) external payable returns (bytes32)',
  'function issueVoucher(bytes32 requestId, bytes calldata xlpSignature) external returns (bytes32)',
  'function getCurrentFee(bytes32 requestId) external view returns (uint256)',
  'function getRequest(bytes32 requestId) external view returns (tuple(address requester, address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement, uint256 createdBlock, bool claimed, bool refunded))',
  'function updateXLPStake(address xlp, uint256 stake) external',
  'function xlpVerifiedStake(address xlp) external view returns (uint256)',
  'function depositETH() external payable',
  'function getXLPETH(address xlp) external view returns (uint256)',
  'function markVoucherFulfilled(bytes32 voucherId) external',
  'function claimSourceFunds(bytes32 voucherId) external',
  'function vouchers(bytes32) external view returns (bytes32 requestId, address xlp, uint256 amount, uint256 fee, uint256 createdBlock, bool fulfilled, bool claimed)',
  'event VoucherRequested(bytes32 indexed requestId, address indexed requester, address token, uint256 amount, uint256 destinationChainId, address recipient, uint256 maxFee, uint256 deadline)',
  'event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp, uint256 fee)'
];

describe('EIL Flow Integration Tests', () => {
  let l1PublicClient: ReturnType<typeof createPublicClient>;
  let l2PublicClient: ReturnType<typeof createPublicClient>;
  let l1WalletClient: ReturnType<typeof createWalletClient>;
  let _l2WalletClient: ReturnType<typeof createWalletClient>;
  let xlpL1: ReturnType<typeof privateKeyToAccount>;
  let xlpL2: ReturnType<typeof privateKeyToAccount>;
  let user: ReturnType<typeof privateKeyToAccount>;
  let deployer: ReturnType<typeof privateKeyToAccount>;
  let eilConfig: EILConfig;
  let isLocalnetRunning = false;

  beforeAll(async () => {
    // Check if localnet is running
    const l1Chain = inferChainFromRpcUrl(L1_RPC);
    const l2Chain = inferChainFromRpcUrl(L2_RPC);
    l1PublicClient = createPublicClient({ chain: l1Chain, transport: http(L1_RPC) });
    l2PublicClient = createPublicClient({ chain: l2Chain, transport: http(L2_RPC) });
    
    try {
      await l1PublicClient.getBlockNumber();
      await l2PublicClient.getBlockNumber();
      isLocalnetRunning = true;
    } catch {
      console.warn('Localnet not running, skipping EIL tests');
      return;
    }
    
    // Load EIL contracts from config file
    const config = loadEilConfig();
    if (!config || !config.l1StakeManager || !config.crossChainPaymaster) {
      console.warn('EIL deployment not found, skipping tests');
      return;
    }
    
    eilConfig = config;
    
    // Setup accounts
    xlpL1 = privateKeyToAccount(ANVIL_KEY_0 as `0x${string}`);
    xlpL2 = privateKeyToAccount(ANVIL_KEY_0 as `0x${string}`);
    user = privateKeyToAccount(ANVIL_KEY_1 as `0x${string}`);
    deployer = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);
    
    l1WalletClient = createWalletClient({ chain: l1Chain, transport: http(L1_RPC), account: xlpL1 });
    l2WalletClient = createWalletClient({ chain: l2Chain, transport: http(L2_RPC), account: xlpL2 });
  });

  test('should have valid deployment config', async () => {
    if (!isLocalnetRunning) return;
    
    expect(eilConfig.l1StakeManager).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(eilConfig.crossChainPaymaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('should register XLP on L1', async () => {
    if (!isLocalnetRunning) return;
    
    const stakeManagerAbi = parseAbi(L1_STAKE_MANAGER_ABI);
    
    // Check if already registered
    const isRegistered = await readContract(l1PublicClient, {
      address: eilConfig.l1StakeManager as Address,
      abi: stakeManagerAbi,
      functionName: 'isXLPActive',
      args: [xlpL1.address],
    });
    
    if (!isRegistered) {
      const hash = await l1WalletClient.writeContract({
        address: eilConfig.l1StakeManager as Address,
        abi: stakeManagerAbi,
        functionName: 'register',
        args: [[1337n, 1n]],
        value: parseEther('10'),
      });
      await waitForTransactionReceipt(l1PublicClient, { hash });
    }
    
    const stake = await readContract(l1PublicClient, {
      address: eilConfig.l1StakeManager as Address,
      abi: stakeManagerAbi,
      functionName: 'getStake',
      args: [xlpL1.address],
    });
    expect(stake.isActive).toBe(true);
    expect(stake.stakedAmount).toBeGreaterThan(0n);
  });

  test('should update XLP stake on L2 paymaster (simulated cross-chain msg)', async () => {
    if (!isLocalnetRunning) return;
    
    const paymasterAbi = parseAbi(PAYMASTER_ABI);
    const deployerWalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: deployer });
    
    // Update stake (simulates cross-chain message)
    const hash = await deployerWalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'updateXLPStake',
      args: [xlpL2.address, parseEther('10')],
    });
    await waitForTransactionReceipt(l2PublicClient, { hash });
    
    const stake = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'xlpVerifiedStake',
      args: [xlpL2.address],
    });
    expect(stake).toBe(parseEther('10'));
  });

  test('should deposit XLP liquidity on L2', async () => {
    if (!isLocalnetRunning) return;
    
    const paymasterAbi = parseAbi(PAYMASTER_ABI);
    const xlpL2WalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: xlpL2 });
    
    // Deposit 10 ETH
    const hash = await xlpL2WalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'depositETH',
      value: parseEther('10'),
    });
    await waitForTransactionReceipt(l2PublicClient, { hash });
    
    const balance = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'getXLPETH',
      args: [xlpL2.address],
    });
    expect(balance).toBeGreaterThanOrEqual(parseEther('10'));
  });

  test('should create voucher request', async () => {
    if (!isLocalnetRunning) return;
    
    const paymasterAbi = parseAbi(PAYMASTER_ABI);
    const userWalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: user });
    
    // Create request for 0.5 ETH transfer to a DIFFERENT chain (1 = Ethereum mainnet)
    const amount = parseEther('0.5');
    const maxFee = parseEther('0.1');
    const feeIncrement = parseEther('0.01');
    const gasOnDestination = 21000n;
    
    const hash = await userWalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'createVoucherRequest',
      args: [
        zeroAddress, // ETH
        amount,
        zeroAddress, // Destination token (ETH)
        1n, // Destination chain (Ethereum mainnet - different from source)
        user.address, // Recipient
        gasOnDestination,
        maxFee,
        feeIncrement,
      ],
      value: amount + maxFee,
    });
    
    const receipt = await waitForTransactionReceipt(l2PublicClient, { hash });
    expect(receipt.status).toBe('success');
    
    // Parse request ID from event
    const logs = await getLogs(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      eventName: 'VoucherRequested',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  test('should issue voucher (XLP commits)', async () => {
    if (!isLocalnetRunning) return;
    
    const paymasterAbi = parseAbi(PAYMASTER_ABI);
    const userWalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: user });
    const xlpL2WalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: xlpL2 });
    
    // Create a new request (to different chain)
    const amount = parseEther('0.3');
    const maxFee = parseEther('0.05');
    const feeIncrement = parseEther('0.001');
    const destChainId = 1n; // Ethereum mainnet
    
    const hash = await userWalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'createVoucherRequest',
      args: [
        zeroAddress,
        amount,
        zeroAddress,
        destChainId,
        user.address,
        21000n,
        maxFee,
        feeIncrement,
      ],
      value: amount + maxFee,
    });
    
    const receipt = await waitForTransactionReceipt(l2PublicClient, { hash });
    
    // Get request ID from event
    const logs = await getLogs(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      eventName: 'VoucherRequested',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const decoded = decodeEventLog({
      abi: paymasterAbi,
      eventName: 'VoucherRequested',
      topics: logs[0].topics,
      data: logs[0].data,
    });
    const requestId = decoded.args.requestId;
    
    // Get fee (for next block)
    const currentFee = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'getCurrentFee',
      args: [requestId],
    });
    const nextBlockFee = currentFee + feeIncrement;
    
    // Create commitment hash
    const commitment = keccak256(
      encodePacked(
        ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
        [requestId, xlpL2.address, amount, nextBlockFee, destChainId]
      )
    );
    
    // Sign with EIP-191 prefix
    const signature = await signMsg(xlpL2, { message: { raw: commitment } });
    
    // XLP issues voucher
    const issueHash = await xlpL2WalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'issueVoucher',
      args: [requestId, signature],
    });
    const issueReceipt = await waitForTransactionReceipt(l2PublicClient, { hash: issueHash });
    
    expect(issueReceipt.status).toBe('success');
    
    // Verify request is claimed
    const request = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'getRequest',
      args: [requestId],
    });
    expect(request.claimed).toBe(true);
  });

  test('should allow XLP to claim source funds after fulfillment', async () => {
    if (!isLocalnetRunning) return;
    
    const paymasterAbi = parseAbi(PAYMASTER_ABI);
    const userWalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: user });
    const xlpL2WalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: xlpL2 });
    const deployerWalletClient = createWalletClient({ chain: inferChainFromRpcUrl(L2_RPC), transport: http(L2_RPC), account: deployer });
    
    // Create request (to different chain)
    const amount = parseEther('0.2');
    const maxFee = parseEther('0.02');
    const feeIncrement = parseEther('0.001');
    const destChainId = 1n; // Ethereum mainnet
    
    const hash = await userWalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'createVoucherRequest',
      args: [
        zeroAddress,
        amount,
        zeroAddress,
        destChainId,
        user.address,
        21000n,
        maxFee,
        feeIncrement,
      ],
      value: amount + maxFee,
    });
    
    const receipt = await waitForTransactionReceipt(l2PublicClient, { hash });
    
    const logs = await getLogs(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      eventName: 'VoucherRequested',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const decoded = decodeEventLog({
      abi: paymasterAbi,
      eventName: 'VoucherRequested',
      topics: logs[0].topics,
      data: logs[0].data,
    });
    const requestId = decoded.args.requestId;
    
    // Get fee
    const currentFee = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'getCurrentFee',
      args: [requestId],
    });
    const nextBlockFee = currentFee + feeIncrement;
    
    // Create signature
    const commitment = keccak256(
      encodePacked(
        ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
        [requestId, xlpL2.address, amount, nextBlockFee, destChainId]
      )
    );
    const signature = await signMsg(xlpL2, { message: { raw: commitment } });
    
    // Issue voucher
    const issueHash = await xlpL2WalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'issueVoucher',
      args: [requestId, signature],
    });
    const issueReceipt = await waitForTransactionReceipt(l2PublicClient, { hash: issueHash });
    
    // Get voucher ID from event
    const issueLogs = await getLogs(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      eventName: 'VoucherIssued',
      fromBlock: issueReceipt.blockNumber,
      toBlock: issueReceipt.blockNumber,
    });
    const issueDecoded = decodeEventLog({
      abi: paymasterAbi,
      eventName: 'VoucherIssued',
      topics: issueLogs[0].topics,
      data: issueLogs[0].data,
    });
    const voucherId = issueDecoded.args.voucherId;
    
    // Mark voucher as fulfilled (simulates cross-chain verification)
    const fulfillHash = await deployerWalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'markVoucherFulfilled',
      args: [voucherId],
    });
    await waitForTransactionReceipt(l2PublicClient, { hash: fulfillHash });
    
    // Advance blocks past claim delay (150 blocks)
    for (let i = 0; i < 151; i++) {
      await l2PublicClient.request({ method: 'evm_mine', params: [] });
    }
    
    // XLP claims source funds
    const _xlpBalanceBefore = await getBalance(l2PublicClient, { address: xlpL2.address });
    const claimHash = await xlpL2WalletClient.writeContract({
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'claimSourceFunds',
      args: [voucherId],
    });
    await waitForTransactionReceipt(l2PublicClient, { hash: claimHash });
    const _xlpBalanceAfter = await getBalance(l2PublicClient, { address: xlpL2.address });
    
    // Verify voucher is claimed
    const voucher = await readContract(l2PublicClient, {
      address: eilConfig.crossChainPaymaster as Address,
      abi: paymasterAbi,
      functionName: 'vouchers',
      args: [voucherId],
    });
    expect(voucher.claimed).toBe(true);
  });
});
