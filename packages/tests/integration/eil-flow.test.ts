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
import { ethers } from 'ethers';
import Bun from 'bun';

// Skip if no localnet running
const L1_RPC = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
const L2_RPC = process.env.L2_RPC_URL || 'http://127.0.0.1:9545';

import { rawDeployments } from '@jejunetwork/contracts';

// Load deployment config
const CONFIG_PATH = './packages/config/eil.json';

interface EILDeployment {
  l1StakeManager: string;
  crossChainPaymaster: string;
  entryPoint: string;
  supportedTokens: string[];
  network: string;
  l1ChainId: number;
  l2ChainId: number;
  deployedAt: number;
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
  let l1Provider: ethers.JsonRpcProvider;
  let l2Provider: ethers.JsonRpcProvider;
  let xlpL1: ethers.Wallet;
  let xlpL2: ethers.Wallet;
  let user: ethers.Wallet;
  let deployer: ethers.Wallet;
  let deployment: EILDeployment;
  let isLocalnetRunning = false;

  beforeAll(async () => {
    // Check if localnet is running
    l1Provider = new ethers.JsonRpcProvider(L1_RPC);
    l2Provider = new ethers.JsonRpcProvider(L2_RPC);
    
    try {
      await l1Provider.getBlockNumber();
      await l2Provider.getBlockNumber();
      isLocalnetRunning = true;
    } catch {
      console.warn('Localnet not running, skipping EIL tests');
      return;
    }
    
    // Load deployment - try @jejunetwork/contracts first, then config file
    const eilDeployment = rawDeployments.eilLocalnet;
    
    if (eilDeployment && Object.keys(eilDeployment).length > 0) {
      deployment = eilDeployment as EILDeployment;
    } else {
      // Fall back to config file
      const configFile = Bun.file(CONFIG_PATH);
      const configExists = await configFile.exists();
      if (!configExists) {
        console.warn('EIL deployment not found, skipping tests');
        return;
      }
      const config = await configFile.json();
      // Build deployment object from config
      deployment = {
        l1StakeManager: config.l1StakeManager,
        crossChainPaymaster: config.crossChainPaymasters['420691'] || config.crossChainPaymasters['1337'],
        entryPoint: config.entryPoint,
        supportedTokens: config.supportedTokens,
        network: 'localnet',
        l1ChainId: 1337,
        l2ChainId: 420691,
        deployedAt: 0
      };
    }
    
    // Setup wallets
    xlpL1 = new ethers.Wallet(ANVIL_KEY_0, l1Provider);
    xlpL2 = new ethers.Wallet(ANVIL_KEY_0, l2Provider);
    user = new ethers.Wallet(ANVIL_KEY_1, l2Provider);
    deployer = new ethers.Wallet(DEPLOYER_KEY, l2Provider);
  });

  test('should have valid deployment config', async () => {
    if (!isLocalnetRunning) return;
    
    expect(deployment.l1StakeManager).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployment.crossChainPaymaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployment.supportedTokens).toContain('0x0000000000000000000000000000000000000000');
  });

  test('should register XLP on L1', async () => {
    if (!isLocalnetRunning) return;
    
    const stakeManager = new ethers.Contract(
      deployment.l1StakeManager,
      L1_STAKE_MANAGER_ABI,
      xlpL1
    );
    
    // Check if already registered
    const isRegistered = await stakeManager.isXLPActive(xlpL1.address);
    
    if (!isRegistered) {
      const tx = await stakeManager.register([1337, 1], {
        value: ethers.parseEther('10')
      });
      await tx.wait();
    }
    
    const stake = await stakeManager.getStake(xlpL1.address);
    expect(stake.isActive).toBe(true);
    expect(stake.stakedAmount).toBeGreaterThan(0n);
  });

  test('should update XLP stake on L2 paymaster (simulated cross-chain msg)', async () => {
    if (!isLocalnetRunning) return;
    
    const paymaster = new ethers.Contract(
      deployment.crossChainPaymaster,
      PAYMASTER_ABI,
      deployer
    );
    
    // Update stake (simulates cross-chain message)
    const tx = await paymaster.updateXLPStake(xlpL2.address, ethers.parseEther('10'));
    await tx.wait();
    
    const stake = await paymaster.xlpVerifiedStake(xlpL2.address);
    expect(stake).toBe(ethers.parseEther('10'));
  });

  test('should deposit XLP liquidity on L2', async () => {
    if (!isLocalnetRunning) return;
    
    const paymaster = new ethers.Contract(
      deployment.crossChainPaymaster,
      PAYMASTER_ABI,
      xlpL2
    );
    
    // Deposit 10 ETH
    const tx = await paymaster.depositETH({
      value: ethers.parseEther('10')
    });
    await tx.wait();
    
    const balance = await paymaster.getXLPETH(xlpL2.address);
    expect(balance).toBeGreaterThanOrEqual(ethers.parseEther('10'));
  });

  test('should create voucher request', async () => {
    if (!isLocalnetRunning) return;
    
    const paymaster = new ethers.Contract(
      deployment.crossChainPaymaster,
      PAYMASTER_ABI,
      user
    );
    
    // Create request for 0.5 ETH transfer to a DIFFERENT chain (1 = Ethereum mainnet)
    const amount = ethers.parseEther('0.5');
    const maxFee = ethers.parseEther('0.1');
    const feeIncrement = ethers.parseEther('0.01');
    const gasOnDestination = 21000n;
    
    const tx = await paymaster.createVoucherRequest(
      ethers.ZeroAddress, // ETH
      amount,
      ethers.ZeroAddress, // Destination token (ETH)
      1, // Destination chain (Ethereum mainnet - different from source)
      user.address, // Recipient
      gasOnDestination,
      maxFee,
      feeIncrement,
      { value: amount + maxFee }
    );
    
    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);
    
    // Parse request ID from event
    const iface = new ethers.Interface(PAYMASTER_ABI);
    const event = receipt?.logs.find(log => {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.name === 'VoucherRequested';
      } catch { return false; }
    });
    expect(event).toBeDefined();
  });

  test('should issue voucher (XLP commits)', async () => {
    if (!isLocalnetRunning) return;
    
    const paymaster = new ethers.Contract(
      deployment.crossChainPaymaster,
      PAYMASTER_ABI,
      user
    );
    
    // Create a new request (to different chain)
    const amount = ethers.parseEther('0.3');
    const maxFee = ethers.parseEther('0.05');
    const feeIncrement = ethers.parseEther('0.001');
    const destChainId = 1; // Ethereum mainnet
    
    const tx = await paymaster.createVoucherRequest(
      ethers.ZeroAddress,
      amount,
      ethers.ZeroAddress,
      destChainId,
      user.address,
      21000n,
      maxFee,
      feeIncrement,
      { value: amount + maxFee }
    );
    
    const receipt = await tx.wait();
    
    // Get request ID from event
    const iface = new ethers.Interface(PAYMASTER_ABI);
    const event = receipt?.logs.find(log => {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.name === 'VoucherRequested';
      } catch { return false; }
    });
    const requestId = event?.topics[1] as string;
    
    // Get fee (for next block)
    const currentFee = await paymaster.getCurrentFee(requestId);
    const nextBlockFee = currentFee + feeIncrement;
    
    // Create commitment hash
    const commitment = ethers.solidityPackedKeccak256(
      ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
      [requestId, xlpL2.address, amount, nextBlockFee, destChainId]
    );
    
    // Sign with EIP-191 prefix
    const signature = await xlpL2.signMessage(ethers.getBytes(commitment));
    
    // XLP issues voucher
    const xlpPaymaster = paymaster.connect(xlpL2);
    const issueTx = await xlpPaymaster.issueVoucher(requestId, signature);
    const issueReceipt = await issueTx.wait();
    
    expect(issueReceipt?.status).toBe(1);
    
    // Verify request is claimed
    const request = await paymaster.getRequest(requestId);
    expect(request.claimed).toBe(true);
  });

  test('should allow XLP to claim source funds after fulfillment', async () => {
    if (!isLocalnetRunning) return;
    
    const paymaster = new ethers.Contract(
      deployment.crossChainPaymaster,
      PAYMASTER_ABI,
      user
    );
    
    // Create request (to different chain)
    const amount = ethers.parseEther('0.2');
    const maxFee = ethers.parseEther('0.02');
    const feeIncrement = ethers.parseEther('0.001');
    const destChainId = 1; // Ethereum mainnet
    
    const tx = await paymaster.createVoucherRequest(
      ethers.ZeroAddress,
      amount,
      ethers.ZeroAddress,
      destChainId,
      user.address,
      21000n,
      maxFee,
      feeIncrement,
      { value: amount + maxFee }
    );
    
    const receipt = await tx.wait();
    
    const iface = new ethers.Interface(PAYMASTER_ABI);
    const event = receipt?.logs.find(log => {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.name === 'VoucherRequested';
      } catch { return false; }
    });
    const requestId = event?.topics[1] as string;
    
    // Get fee
    const currentFee = await paymaster.getCurrentFee(requestId);
    const nextBlockFee = currentFee + feeIncrement;
    
    // Create signature
    const commitment = ethers.solidityPackedKeccak256(
      ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
      [requestId, xlpL2.address, amount, nextBlockFee, destChainId]
    );
    const signature = await xlpL2.signMessage(ethers.getBytes(commitment));
    
    // Issue voucher
    const xlpPaymaster = paymaster.connect(xlpL2);
    const issueTx = await xlpPaymaster.issueVoucher(requestId, signature);
    const issueReceipt = await issueTx.wait();
    
    // Get voucher ID from event
    const issueEvent = issueReceipt?.logs.find(log => {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.name === 'VoucherIssued';
      } catch { return false; }
    });
    const voucherId = issueEvent?.topics[1] as string;
    
    // Mark voucher as fulfilled (simulates cross-chain verification)
    const ownerPaymaster = paymaster.connect(deployer);
    await (await ownerPaymaster.markVoucherFulfilled(voucherId)).wait();
    
    // Advance blocks past claim delay (150 blocks)
    for (let i = 0; i < 151; i++) {
      await l2Provider.send('evm_mine', []);
    }
    
    // XLP claims source funds
    const xlpBalanceBefore = await l2Provider.getBalance(xlpL2.address);
    const claimTx = await xlpPaymaster.claimSourceFunds(voucherId);
    await claimTx.wait();
    const xlpBalanceAfter = await l2Provider.getBalance(xlpL2.address);
    
    // Verify voucher is claimed
    const voucher = await paymaster.vouchers(voucherId);
    expect(voucher.claimed).toBe(true);
  });
});
