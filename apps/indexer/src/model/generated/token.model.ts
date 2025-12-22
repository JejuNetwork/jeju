import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { DEXPool } from './dexPool.model'
import { Swap } from './swap.model'
import { TokenCandle } from './tokenCandle.model'

/**
 * Token with full market data - aggregated from DEX swaps.
 * Extends Contract entity with trading-specific fields.
 */
@Entity_()
export class Token {
  constructor(props?: Partial<Token>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  address!: string

  @Index_()
  @IntColumn_({ nullable: false })
  chainId!: number

  @Index_()
  @StringColumn_({ nullable: false })
  symbol!: string

  @StringColumn_({ nullable: false })
  name!: string

  @IntColumn_({ nullable: false })
  decimals!: number

  @BigIntColumn_({ nullable: false })
  totalSupply!: bigint

  @StringColumn_({ nullable: true })
  priceUSD!: string | undefined | null

  @StringColumn_({ nullable: true })
  priceETH!: string | undefined | null

  @BigIntColumn_({ nullable: false })
  volume24h!: bigint

  @StringColumn_({ nullable: false })
  volumeUSD24h!: string

  @IntColumn_({ nullable: false })
  txCount24h!: number

  @BigIntColumn_({ nullable: false })
  liquidity!: bigint

  @StringColumn_({ nullable: false })
  liquidityUSD!: string

  @IntColumn_({ nullable: true })
  priceChange1h!: number | undefined | null

  @IntColumn_({ nullable: true })
  priceChange24h!: number | undefined | null

  @IntColumn_({ nullable: true })
  priceChange7d!: number | undefined | null

  @StringColumn_({ nullable: true })
  athPrice!: string | undefined | null

  @DateTimeColumn_({ nullable: true })
  athTimestamp!: Date | undefined | null

  @IntColumn_({ nullable: false })
  holderCount!: number

  @IntColumn_({ nullable: false })
  poolCount!: number

  @StringColumn_({ nullable: true })
  logoUrl!: string | undefined | null

  @StringColumn_({ nullable: true })
  websiteUrl!: string | undefined | null

  @Index_()
  @BooleanColumn_({ nullable: false })
  verified!: boolean

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  creator!: Account | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: true })
  lastSwapAt!: Date | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date

  @OneToMany_(
    () => DEXPool,
    (e) => e.token0,
  )
  pools0!: DEXPool[]

  @OneToMany_(
    () => DEXPool,
    (e) => e.token1,
  )
  pools1!: DEXPool[]

  @OneToMany_(
    () => Swap,
    (e) => e.tokenIn,
  )
  swapsIn!: Swap[]

  @OneToMany_(
    () => Swap,
    (e) => e.tokenOut,
  )
  swapsOut!: Swap[]

  @OneToMany_(
    () => TokenCandle,
    (e) => e.token,
  )
  candles!: TokenCandle[]
}
