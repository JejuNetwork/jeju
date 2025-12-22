import { ZERO_ADDRESS } from '@jejunetwork/ui'
import { isNativeToken } from './contracts'

interface LiquidityConfig {
  chains: Array<{ chainId: number; name: string }>
  refreshIntervalMs?: number
  verbose?: boolean
}

/** Minimal interface for balance fetching - what LiquidityManager actually uses from PublicClient */
export interface BalanceClient {
  getBalance: (params: { address: `0x${string}` }) => Promise<bigint>
}

/** Minimal interface for wallet account access - what LiquidityManager actually uses from WalletClient */
export interface AccountClient {
  account: { address: `0x${string}` } | undefined
}

/** Client pair used by LiquidityManager */
export interface LiquidityClients {
  public: BalanceClient
  wallet?: AccountClient
}

export class LiquidityManager {
  private config: LiquidityConfig
  private balances = new Map<number, Map<string, bigint>>()
  private clients = new Map<number, LiquidityClients>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: LiquidityConfig) {
    this.config = config
  }

  async initialize(clients: Map<number, LiquidityClients>): Promise<void> {
    this.clients = clients
    if (this.config.verbose) console.log('💰 Initializing liquidity...')

    await this.refresh()
    this.refreshTimer = setInterval(
      () => this.refresh(),
      this.config.refreshIntervalMs ?? 30_000,
    )
  }

  async refresh(): Promise<void> {
    for (const chain of this.config.chains) {
      const client = this.clients.get(chain.chainId)
      const account = client?.wallet?.account
      if (!account) continue

      const balance = await client.public.getBalance({
        address: account.address,
      })
      this.balances.set(chain.chainId, new Map([[ZERO_ADDRESS, balance]]))

      if (this.config.verbose) {
        console.log(
          `   ${chain.name}: ${(Number(balance) / 1e18).toFixed(4)} ETH`,
        )
      }
    }
  }

  async hasLiquidity(
    chainId: number,
    token: string,
    amount: string,
  ): Promise<boolean> {
    const chainBal = this.balances.get(chainId)
    if (!chainBal) return false

    const key = isNativeToken(token) ? ZERO_ADDRESS : token.toLowerCase()
    const available = chainBal.get(key) ?? 0n
    const required = BigInt(amount)

    if (available < required && this.config.verbose) {
      console.log(
        `   💸 Insufficient: have ${(Number(available) / 1e18).toFixed(4)}, need ${(Number(required) / 1e18).toFixed(4)}`,
      )
    }
    return available >= required
  }

  async recordFill(
    chainId: number,
    token: string,
    amount: string,
  ): Promise<void> {
    const chainBal = this.balances.get(chainId)
    if (!chainBal) return

    const key = isNativeToken(token) ? ZERO_ADDRESS : token.toLowerCase()
    const current = chainBal.get(key) ?? 0n
    chainBal.set(key, current - BigInt(amount))

    if (this.config.verbose) {
      console.log(
        `   💸 -${(Number(amount) / 1e18).toFixed(4)} ETH on chain ${chainId}`,
      )
    }

    this.refreshChain(chainId)
  }

  private async refreshChain(chainId: number): Promise<void> {
    const client = this.clients.get(chainId)
    const account = client?.wallet?.account
    if (!account) return

    const balance = await client.public.getBalance({ address: account.address })
    this.balances.get(chainId)?.set(ZERO_ADDRESS, balance)
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  getBalance(chainId: number, token: string): bigint {
    const key = isNativeToken(token) ? ZERO_ADDRESS : token.toLowerCase()
    return this.balances.get(chainId)?.get(key) ?? 0n
  }
}
