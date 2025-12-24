/**
 * Payments Actions - Balance and credits
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { formatEther } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import { validateServiceExists } from '../validation'

export const checkBalanceAction: Action = {
  name: 'CHECK_BALANCE',
  description: 'Check wallet balance and prepaid credits',
  similes: [
    'balance',
    'check balance',
    'my balance',
    'how much',
    'wallet balance',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const balance = await client.payments.getBalance()
    const computeCredits = await client.payments.getCredits('compute')
    const storageCredits = await client.payments.getCredits('storage')
    const inferenceCredits = await client.payments.getCredits('inference')

    callback?.({
      text: `Wallet Balance:
Address: ${client.address}
Network: ${client.network} (Chain ${client.chainId})
Account Type: ${client.isSmartAccount ? 'Smart Account' : 'EOA'}

Native Balance: ${formatEther(balance)} ETH

Prepaid Credits:
- Compute: ${computeCredits.balanceFormatted} ETH
- Storage: ${storageCredits.balanceFormatted} ETH
- Inference: ${inferenceCredits.balanceFormatted} ETH`,
      content: {
        address: client.address,
        network: client.network,
        balance: balance.toString(),
        balanceFormatted: formatEther(balance),
        credits: {
          compute: computeCredits.balance.toString(),
          storage: storageCredits.balance.toString(),
          inference: inferenceCredits.balance.toString(),
        },
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Check my balance' },
      },
      {
        name: 'agent',
        content: { text: 'Wallet Balance: Native Balance: 1.5 ETH...' },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'How much ETH do I have?' },
      },
      {
        name: 'agent',
        content: { text: 'Native Balance: 2.3 ETH...' },
      },
    ],
  ],
}
