/**
 * LINK Staking CLI - Manage LINK token staking on Ethereum
 * Usage: bun run scripts/chainlink/stake.ts [status|stake|unstake|claim] [--amount N]
 */

import { createPublicClient, createWalletClient, http, type Hex, parseEther, formatEther, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { parseArgs } from 'util';

const STAKING_ADDRESS = '0xBEa698E8B4Cd9CdD3D3Ba98aAeae5EC49a2D42E4' as const;
const LINK_ADDRESS = '0x514910771AF9Ca656af840dff83E8264EcF986CA' as const;

const STAKING_ABI = parseAbi([
  'function stake(uint256 amount) external',
  'function unstake(uint256 amount) external',
  'function claimReward() external returns (uint256)',
  'function getStakerPrincipal(address staker) view returns (uint256)',
  'function getBaseReward(address staker) view returns (uint256)',
  'function getDelegationReward(address staker) view returns (uint256)',
  'function getCommunityStakerLimits() view returns (uint256 min, uint256 max)',
  'function isActive() view returns (bool)',
  'function getUnbondingEndsAt(address staker) view returns (uint256)',
  'function getUnbondingAmount(address staker) view returns (uint256)',
  'function canUnstake(address staker) view returns (bool)',
  'event RewardClaimed(address indexed staker, uint256 amount)',
]);

const LINK_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

function createClients() {
  const privateKey = process.env.STAKING_PRIVATE_KEY as Hex;
  if (!privateKey) throw new Error('STAKING_PRIVATE_KEY not set');

  const rpcUrl = process.env.ETHEREUM_RPC_URL ?? 'https://eth.llamarpc.com';
  const account = privateKeyToAccount(privateKey);

  return {
    publicClient: createPublicClient({ chain: mainnet, transport: http(rpcUrl) }),
    walletClient: createWalletClient({ account, chain: mainnet, transport: http(rpcUrl) }),
    account,
  };
}

async function getStatus() {
  const { publicClient, account } = createClients();
  const address = account.address;

  const [stakedAmount, baseReward, delegationReward, stakingActive, unbondingAmount, unbondingEndsAt, canUnstake, linkBalance, limits] = await Promise.all([
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getStakerPrincipal', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getBaseReward', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getDelegationReward', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'isActive' }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getUnbondingAmount', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getUnbondingEndsAt', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'canUnstake', args: [address] }),
    publicClient.readContract({ address: LINK_ADDRESS, abi: LINK_ABI, functionName: 'balanceOf', args: [address] }),
    publicClient.readContract({ address: STAKING_ADDRESS, abi: STAKING_ABI, functionName: 'getCommunityStakerLimits' }),
  ]);

  const totalReward = (baseReward as bigint) + (delegationReward as bigint);
  const [minStake, maxStake] = limits as [bigint, bigint];

  console.log('\n=== LINK Staking Status ===\n');
  console.log('Pool:', stakingActive ? 'Active' : 'Inactive');
  console.log(`Staked:     ${formatEther(stakedAmount as bigint)} LINK`);
  console.log(`Balance:    ${formatEther(linkBalance as bigint)} LINK`);
  console.log(`Rewards:    ${formatEther(totalReward)} LINK`);
  console.log(`Limits:     ${formatEther(minStake)} - ${formatEther(maxStake)} LINK`);

  if ((unbondingAmount as bigint) > 0n) {
    console.log(`\nUnbonding:  ${formatEther(unbondingAmount as bigint)} LINK`);
    console.log(`Ends:       ${new Date(Number(unbondingEndsAt) * 1000).toISOString()}`);
    console.log(`Withdrawable: ${canUnstake ? 'Yes' : 'No'}`);
  }
}

async function stake(amount: bigint) {
  const { publicClient, walletClient, account } = createClients();

  const allowance = await publicClient.readContract({
    address: LINK_ADDRESS,
    abi: LINK_ABI,
    functionName: 'allowance',
    args: [account.address, STAKING_ADDRESS],
  }) as bigint;

  if (allowance < amount) {
    console.log('Approving LINK...');
    const approveHash = await walletClient.writeContract({
      address: LINK_ADDRESS,
      abi: LINK_ABI,
      functionName: 'approve',
      args: [STAKING_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  console.log(`Staking ${formatEther(amount)} LINK...`);
  const hash = await walletClient.writeContract({
    address: STAKING_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'stake',
    args: [amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done: https://etherscan.io/tx/${hash} (gas: ${receipt.gasUsed})`);
}

async function unstake(amount: bigint) {
  const { publicClient, walletClient } = createClients();

  console.log(`Unstaking ${formatEther(amount)} LINK (28-day unbonding)...`);
  const hash = await walletClient.writeContract({
    address: STAKING_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'unstake',
    args: [amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done: https://etherscan.io/tx/${hash} (gas: ${receipt.gasUsed})`);
}

async function claim() {
  const { publicClient, walletClient } = createClients();

  console.log('Claiming rewards...');
  const hash = await walletClient.writeContract({
    address: STAKING_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'claimReward',
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let claimedAmount = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === STAKING_ADDRESS.toLowerCase()) {
      const decoded = decodeEventLog({ abi: STAKING_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === 'RewardClaimed') {
        claimedAmount = (decoded.args as { amount: bigint }).amount;
      }
    }
  }
  console.log(`Claimed: ${formatEther(claimedAmount)} LINK`);
  console.log(`Tx: https://etherscan.io/tx/${hash}`);
}

async function main() {
  const args = parseArgs({ allowPositionals: true, options: { amount: { type: 'string' } } });
  const command = args.positionals[0] ?? 'status';

  switch (command) {
    case 'status':
      await getStatus();
      break;
    case 'stake':
      if (!args.values.amount) throw new Error('--amount required');
      await stake(parseEther(args.values.amount));
      break;
    case 'unstake':
      if (!args.values.amount) throw new Error('--amount required');
      await unstake(parseEther(args.values.amount));
      break;
    case 'claim':
      await claim();
      break;
    default:
      console.log('Usage: stake.ts [status|stake|unstake|claim] [--amount N]');
  }
}

main().catch(console.error);
