import type { Address } from 'viem';
import { getChainId } from './wagmi';

// Contract addresses by network
const ADDRESSES: Record<number, Record<string, Address>> = {
  // Localnet
  31337: {
    identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
    reputationRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
    bountyRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
    guardianRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
    containerRegistry: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as Address,
    modelRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
    projectBoard: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
    repoRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address,
    packageRegistry: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6' as Address,
    moderationMarketplace: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318' as Address,
    jobRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' as Address,
    feeDistributor: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e' as Address,
  },
  // Testnet (Base Sepolia)
  84532: {
    identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
    reputationRegistry: '0x0000000000000000000000000000000000000000' as Address,
    bountyRegistry: '0x0000000000000000000000000000000000000000' as Address,
    guardianRegistry: '0x0000000000000000000000000000000000000000' as Address,
    containerRegistry: '0x0000000000000000000000000000000000000000' as Address,
    modelRegistry: '0x0000000000000000000000000000000000000000' as Address,
    projectBoard: '0x0000000000000000000000000000000000000000' as Address,
    repoRegistry: '0x0000000000000000000000000000000000000000' as Address,
    packageRegistry: '0x0000000000000000000000000000000000000000' as Address,
    moderationMarketplace: '0x0000000000000000000000000000000000000000' as Address,
    jobRegistry: '0x0000000000000000000000000000000000000000' as Address,
    feeDistributor: '0x0000000000000000000000000000000000000000' as Address,
  },
  // Mainnet (Base)
  8453: {
    identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
    reputationRegistry: '0x0000000000000000000000000000000000000000' as Address,
    bountyRegistry: '0x0000000000000000000000000000000000000000' as Address,
    guardianRegistry: '0x0000000000000000000000000000000000000000' as Address,
    containerRegistry: '0x0000000000000000000000000000000000000000' as Address,
    modelRegistry: '0x0000000000000000000000000000000000000000' as Address,
    projectBoard: '0x0000000000000000000000000000000000000000' as Address,
    repoRegistry: '0x0000000000000000000000000000000000000000' as Address,
    packageRegistry: '0x0000000000000000000000000000000000000000' as Address,
    moderationMarketplace: '0x0000000000000000000000000000000000000000' as Address,
    jobRegistry: '0x0000000000000000000000000000000000000000' as Address,
    feeDistributor: '0x0000000000000000000000000000000000000000' as Address,
  },
};

export function getContractAddress(name: keyof (typeof ADDRESSES)[31337]): Address {
  const chainId = getChainId();
  const addresses = ADDRESSES[chainId];
  if (!addresses) {
    throw new Error(`No addresses configured for chain ${chainId}`);
  }
  const address = addresses[name];
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Contract ${name} not deployed on chain ${chainId}`);
  }
  return address;
}

export function getContractAddressSafe(name: keyof (typeof ADDRESSES)[31337]): Address | null {
  const chainId = getChainId();
  const addresses = ADDRESSES[chainId];
  if (!addresses) return null;
  const address = addresses[name];
  if (!address || address === '0x0000000000000000000000000000000000000000') return null;
  return address;
}

