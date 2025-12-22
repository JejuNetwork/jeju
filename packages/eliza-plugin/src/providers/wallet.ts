/**
 * Wallet Provider - Provides wallet context to agent
 */

import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  type State,
} from "@elizaos/core";
import { formatEther } from "viem";
import { getNetworkName } from "@jejunetwork/config";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import { expect } from "../validation";

const networkName = getNetworkName();

export const jejuWalletProvider: Provider = {
  name: `${networkName}WalletProvider`,

  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
  ): Promise<ProviderResult> {
    const service = runtime.getService(JEJU_SERVICE_NAME) as
      | JejuService
      | undefined;

    if (!service) {
      return {
        text: `${networkName} wallet not connected`,
        data: {},
        values: {},
      };
    }

    const walletData = await service.getCachedData();

    if (!walletData) {
      return {
        text: `${networkName} wallet data unavailable`,
        data: {},
        values: {},
      };
    }

    const balanceFormatted = formatEther(BigInt(walletData.balance));
    const agentName = expect(state?.agentName, "agentName in state");

    const text = `${agentName}'s ${networkName} Wallet:
Address: ${walletData.address}
Network: ${walletData.network} (Chain ID: ${walletData.chainId})
Balance: ${balanceFormatted} ETH
Account Type: ${walletData.isSmartAccount ? "Smart Account (ERC-4337)" : "EOA"}`;

    return {
      text,
      data: {
        address: walletData.address,
        network: walletData.network,
        chainId: walletData.chainId,
        balance: walletData.balance,
        balanceFormatted,
        isSmartAccount: walletData.isSmartAccount,
      },
      values: {
        address: walletData.address,
        network: walletData.network,
        chainId: walletData.chainId.toString(),
        balance: walletData.balance,
        isSmartAccount: walletData.isSmartAccount.toString(),
      },
    };
  },
};
