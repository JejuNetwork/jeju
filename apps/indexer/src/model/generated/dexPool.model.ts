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
import { DEX } from './dex.model'
import { PoolDailyCandle } from './poolDailyCandle.model'
import { PoolHourlyCandle } from './poolHourlyCandle.model'
import { Swap } from './swap.model'
import { Token } from './token.model'

/**
 * DEX/AMM pool instance - tracks liquidity and reserves.
 */
@Entity_()
export class DEXPool {
  constructor(props?: Partial<DEXPool>) {
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
  @ManyToOne_(() => DEX, { nullable: true })
  dex!: DEX

  @Index_()
  @ManyToOne_(() => Token, { nullable: true })
  token0!: Token

  @Index_()
  @ManyToOne_(() => Token, { nullable: true })
  token1!: Token

  @IntColumn_({ nullable: false })
  fee!: number

  @BigIntColumn_({ nullable: false })
  reserve0!: bigint

  @BigIntColumn_({ nullable: false })
  reserve1!: bigint

  @BigIntColumn_({ nullable: false })
  totalLiquidity!: bigint

  @StringColumn_({ nullable: false })
  liquidityUSD!: string

  @StringColumn_({ nullable: false })
  token0Price!: string

  @StringColumn_({ nullable: false })
  token1Price!: string

  @StringColumn_({ nullable: true })
  token0PriceUSD!: string | undefined | null

  @StringColumn_({ nullable: true })
  token1PriceUSD!: string | undefined | null

  @BigIntColumn_({ nullable: false })
  volumeToken0!: bigint

  @BigIntColumn_({ nullable: false })
  volumeToken1!: bigint

  @StringColumn_({ nullable: false })
  volumeUSD!: string

  @IntColumn_({ nullable: false })
  txCount!: number

  @StringColumn_({ nullable: false })
  feesUSD!: string

  @BigIntColumn_({ nullable: true })
  sqrtPriceX96!: bigint | undefined | null

  @IntColumn_({ nullable: true })
  tick!: number | undefined | null

  @Index_()
  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date

  @OneToMany_(
    () => Swap,
    (e) => e.pool,
  )
  swaps!: Swap[]

  @OneToMany_(
    () => PoolHourlyCandle,
    (e) => e.pool,
  )
  hourlyCandles!: PoolHourlyCandle[]

  @OneToMany_(
    () => PoolDailyCandle,
    (e) => e.pool,
  )
  dailyCandles!: PoolDailyCandle[]
}
