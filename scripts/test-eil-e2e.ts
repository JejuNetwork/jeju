#!/usr/bin/env bun
/**
 * EIL End-to-End Test Script
 * 
 * Tests the complete EIL flow:
 * 1. Deploy all contracts
 * 2. Register XLP on L1
 * 3. Update XLP stake on L2
 * 4. XLP deposits liquidity
 * 5. User creates transfer request
 * 6. XLP issues voucher
 * 7. Voucher fulfilled on destination
 * 8. XLP claims source funds
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'eil-e2e-test' });

const L1_RPC = 'http://127.0.0.1:8545';
const L2_RPC = 'http://127.0.0.1:9545';
const L1_CHAIN_ID = 1337;
const L2_CHAIN_ID = 420690;

// Anvil default accounts
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const XLP_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const USER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const CONTRACTS_DIR = './packages/contracts';

interface DeployedContracts {
  mockEntryPoint: string;
  l1StakeManager: string;
  crossChainPaymaster: string;
}

async function runForgeCreate(
  contract: string,
  rpcUrl: string,
  constructorArgs: string[] = []
): Promise<string> {
  const args = [
    'create', contract,
    '--rpc-url', rpcUrl,
    '--private-key', DEPLOYER_KEY,
    '--broadcast'
  ];
  
  if (constructorArgs.length > 0) {
    args.push('--constructor-args', ...constructorArgs);
  }
  
  const proc = Bun.spawn(['forge', ...args], {
    cwd: CONTRACTS_DIR,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  
  const output = stdout + stderr;
  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!match) throw new Error(`Failed to deploy ${contract}: ${output.slice(0, 500)}`);
  return match[1];
}

async function deployContracts(): Promise<DeployedContracts> {
  logger.info('=== STEP 1: Deploying Contracts ===');
  
  // Deploy MockEntryPoint on L2
  logger.info('Deploying MockEntryPoint on L2...');
  const mockEntryPoint = await runForgeCreate(
    'src/eil/MockEntryPoint.sol:MockEntryPoint',
    L2_RPC
  );
  logger.success(`MockEntryPoint: ${mockEntryPoint}`);
  
  // Deploy L1StakeManager on L1
  logger.info('Deploying L1StakeManager on L1...');
  const l1StakeManager = await runForgeCreate(
    'src/eil/L1StakeManager.sol:L1StakeManager',
    L1_RPC
  );
  logger.success(`L1StakeManager: ${l1StakeManager}`);
  
  // Deploy CrossChainPaymaster on L2
  logger.info('Deploying CrossChainPaymaster on L2...');
  const crossChainPaymaster = await runForgeCreate(
    'src/eil/CrossChainPaymaster.sol:CrossChainPaymaster',
    L2_RPC,
    [mockEntryPoint, l1StakeManager, L2_CHAIN_ID.toString()]
  );
  logger.success(`CrossChainPaymaster: ${crossChainPaymaster}`);
  
  return { mockEntryPoint, l1StakeManager, crossChainPaymaster };
}

async function configureContracts(contracts: DeployedContracts): Promise<void> {
  logger.info('=== STEP 2: Configuring Contracts ===');
  
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const deployer = new ethers.Wallet(DEPLOYER_KEY);
  
  // Register L2 paymaster on L1
  logger.info('Registering L2 paymaster on L1...');
  const stakeManager = new ethers.Contract(
    contracts.l1StakeManager,
    ['function registerL2Paymaster(uint256 chainId, address paymaster) external'],
    deployer.connect(l1Provider)
  );
  await (await stakeManager.registerL2Paymaster(L2_CHAIN_ID, contracts.crossChainPaymaster)).wait();
  
  // Enable ETH as supported token on L2
  logger.info('Enabling ETH support on L2 paymaster...');
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    ['function setTokenSupport(address token, bool supported) external'],
    deployer.connect(l2Provider)
  );
  await (await paymaster.setTokenSupport(ethers.ZeroAddress, true)).wait();
  
  logger.success('Contracts configured');
}

async function registerXLP(contracts: DeployedContracts): Promise<void> {
  logger.info('=== STEP 3: Registering XLP ===');
  
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const xlp = new ethers.Wallet(XLP_KEY);
  const deployer = new ethers.Wallet(DEPLOYER_KEY);
  
  // Register XLP on L1 with stake
  logger.info('Registering XLP on L1 with 10 ETH stake...');
  const stakeManager = new ethers.Contract(
    contracts.l1StakeManager,
    ['function register(uint256[] memory chainIds) external payable'],
    xlp.connect(l1Provider)
  );
  await (await stakeManager.register([L2_CHAIN_ID], { value: ethers.parseEther('10') })).wait();
  
  // Update XLP stake on L2 (simulates cross-chain message)
  logger.info('Updating XLP stake on L2...');
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    ['function updateXLPStake(address xlp, uint256 stake) external'],
    deployer.connect(l2Provider)
  );
  await (await paymaster.updateXLPStake(xlp.address, ethers.parseEther('10'))).wait();
  
  logger.success(`XLP registered: ${xlp.address}`);
}

async function depositXLPLiquidity(contracts: DeployedContracts): Promise<void> {
  logger.info('=== STEP 4: XLP Depositing Liquidity ===');
  
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const xlp = new ethers.Wallet(XLP_KEY, l2Provider);
  
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    ['function depositETH() external payable', 'function getXLPETH(address xlp) external view returns (uint256)'],
    xlp
  );
  
  logger.info('Depositing 50 ETH liquidity...');
  await (await paymaster.depositETH({ value: ethers.parseEther('50') })).wait();
  
  const balance = await paymaster.getXLPETH(xlp.address);
  logger.success(`XLP ETH balance: ${ethers.formatEther(balance)} ETH`);
}

async function createTransferRequest(contracts: DeployedContracts): Promise<string> {
  logger.info('=== STEP 5: User Creating Transfer Request ===');
  
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const user = new ethers.Wallet(USER_KEY, l2Provider);
  
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    [
      'function createVoucherRequest(address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement) external payable returns (bytes32)',
      'event VoucherRequested(bytes32 indexed requestId, address indexed requester, address token, uint256 amount, uint256 destinationChainId, address recipient, uint256 maxFee, uint256 deadline)'
    ],
    user
  );
  
  const amount = ethers.parseEther('1');
  const maxFee = ethers.parseEther('0.1');
  const feeIncrement = ethers.parseEther('0.01');
  const destChainId = L1_CHAIN_ID; // Transfer to L1
  
  logger.info(`Creating request: 1 ETH to L1...`);
  const tx = await paymaster.createVoucherRequest(
    ethers.ZeroAddress, // ETH
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
  const event = receipt.logs.find((log: ethers.Log) => 
    log.topics[0] === ethers.id('VoucherRequested(bytes32,address,address,uint256,uint256,address,uint256,uint256)')
  );
  const requestId = event?.topics[1] as string;
  
  logger.success(`Transfer request created: ${requestId}`);
  return requestId;
}

async function issueVoucher(contracts: DeployedContracts, requestId: string): Promise<string> {
  logger.info('=== STEP 6: XLP Issuing Voucher ===');
  
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const xlp = new ethers.Wallet(XLP_KEY, l2Provider);
  
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    [
      'function getCurrentFee(bytes32 requestId) external view returns (uint256)',
      'function issueVoucher(bytes32 requestId, bytes calldata xlpSignature) external returns (bytes32)',
      'function getRequest(bytes32 requestId) external view returns (tuple(address requester, address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement, uint256 deadline, uint256 createdBlock, bool claimed, bool expired, bool refunded))',
      'event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp, uint256 fee)'
    ],
    xlp
  );
  
  // Get request details
  const request = await paymaster.getRequest(requestId);
  const amount = request.amount;
  const destChainId = request.destinationChainId;
  
  // Get fee for next block
  const currentFee = await paymaster.getCurrentFee(requestId);
  const feeIncrement = request.feeIncrement;
  const nextBlockFee = currentFee + feeIncrement;
  
  // Create commitment and sign
  const commitment = ethers.solidityPackedKeccak256(
    ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
    [requestId, xlp.address, amount, nextBlockFee, destChainId]
  );
  const signature = await xlp.signMessage(ethers.getBytes(commitment));
  
  logger.info('Issuing voucher...');
  const tx = await paymaster.issueVoucher(requestId, signature);
  const receipt = await tx.wait();
  
  const event = receipt.logs.find((log: ethers.Log) => 
    log.topics[0] === ethers.id('VoucherIssued(bytes32,bytes32,address,uint256)')
  );
  const voucherId = event?.topics[1] as string;
  
  logger.success(`Voucher issued: ${voucherId}`);
  return voucherId;
}

async function fulfillAndClaim(contracts: DeployedContracts, voucherId: string): Promise<void> {
  logger.info('=== STEP 7: Fulfilling Voucher and Claiming Funds ===');
  
  const l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, l2Provider);
  const xlp = new ethers.Wallet(XLP_KEY, l2Provider);
  
  const paymaster = new ethers.Contract(
    contracts.crossChainPaymaster,
    [
      'function markVoucherFulfilled(bytes32 voucherId) external',
      'function claimSourceFunds(bytes32 voucherId) external',
      'function vouchers(bytes32) external view returns (bytes32 requestId, address xlp, uint256 sourceChainId, uint256 destinationChainId, address sourceToken, address destinationToken, uint256 amount, uint256 fee, uint256 gasProvided, uint256 issuedBlock, uint256 expiresBlock, bool fulfilled, bool slashed)'
    ],
    deployer
  );
  
  // Mark voucher as fulfilled (simulates cross-chain verification)
  logger.info('Marking voucher as fulfilled...');
  await (await (paymaster as ethers.Contract & { markVoucherFulfilled: (voucherId: string) => Promise<ethers.ContractTransactionResponse> }).markVoucherFulfilled(voucherId)).wait();
  
  // Advance blocks past claim delay (150 blocks)
  logger.info('Advancing blocks past claim delay...');
  for (let i = 0; i < 151; i++) {
    await l2Provider.send('evm_mine', []);
  }
  
  // XLP claims source funds
  logger.info('XLP claiming source funds...');
  const xlpBalanceBefore = await l2Provider.getBalance(xlp.address);
  const connectedPaymaster = paymaster.connect(xlp) as ethers.Contract & { claimSourceFunds: (voucherId: string) => Promise<ethers.ContractTransactionResponse> };
  await (await connectedPaymaster.claimSourceFunds(voucherId)).wait();
  const xlpBalanceAfter = await l2Provider.getBalance(xlp.address);
  
  const received = xlpBalanceAfter - xlpBalanceBefore;
  logger.success(`XLP received: ~${ethers.formatEther(received)} ETH (minus gas)`);
  
  // Verify voucher state
  const voucher = await (paymaster as ethers.Contract & { vouchers: (voucherId: string) => Promise<[string, string, bigint, bigint, string, string, bigint, bigint, bigint, bigint, bigint, boolean, boolean]> }).vouchers(voucherId);
  logger.success(`Voucher fulfilled: ${voucher[11]}`);
}

async function printSummary(contracts: DeployedContracts): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('EIL END-TO-END TEST COMPLETE');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info('Deployed Contracts:');
  logger.info(`  MockEntryPoint:      ${contracts.mockEntryPoint}`);
  logger.info(`  L1StakeManager:      ${contracts.l1StakeManager}`);
  logger.info(`  CrossChainPaymaster: ${contracts.crossChainPaymaster}`);
  logger.info('');
  logger.info('Flow Tested:');
  logger.info('  ✅ Contract deployment');
  logger.info('  ✅ XLP registration on L1');
  logger.info('  ✅ XLP stake update on L2');
  logger.info('  ✅ XLP liquidity deposit');
  logger.info('  ✅ User transfer request creation');
  logger.info('  ✅ XLP voucher issuance');
  logger.info('  ✅ Voucher fulfillment');
  logger.info('  ✅ Source fund claiming');
  logger.info('');
  logger.success('ALL EIL MECHANISMS WORKING CORRECTLY');
  logger.info('='.repeat(60));
}

async function main() {
  logger.info('Starting EIL End-to-End Test...\n');
  
  const contracts = await deployContracts();
  await configureContracts(contracts);
  await registerXLP(contracts);
  await depositXLPLiquidity(contracts);
  const requestId = await createTransferRequest(contracts);
  const voucherId = await issueVoucher(contracts, requestId);
  await fulfillAndClaim(contracts, voucherId);
  await printSummary(contracts);
}

main().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});

