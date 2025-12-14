/**
 * DeFi Provider - Token prices and positions context
 */

import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  type State,
} from '@elizaos/core';
import { formatEther } from 'viem';
import { getNetworkName } from '@jejunetwork/config';
import { JEJU_SERVICE_NAME, type JejuService } from '../service';

const networkName = getNetworkName();

export const jejuDefiProvider: Provider = {
  name: `${networkName}DefiProvider`,

  async get(runtime: IAgentRuntime, _message: Memory, state?: State): Promise<ProviderResult> {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService | undefined;

    if (!service) {
      return {
        text: `${networkName} DeFi not available`,
        data: {},
        values: {},
      };
    }

    const client = service.getClient();

    const pools = await client.defi.listPools();
    const positions = await client.defi.listPositions();

    const text = `Active Pools: ${pools.length}
Your LP Positions: ${positions.length}
${pools.slice(0, 3).map((p) => `- ${p.token0.symbol}/${p.token1.symbol}: TVL ${formatEther(p.liquidity)}`).join('\n')}`;

    return {
      text,
      data: {
        pools: pools.slice(0, 10),
        positions,
      },
      values: {
        poolCount: pools.length.toString(),
        positionCount: positions.length.toString(),
      },
    };
  },
};

