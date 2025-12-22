import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { CandleInterval } from './_candleInterval'
import { Token } from './token.model'

/**
 * OHLCV candle for a token (aggregated from swaps).
 */
@Entity_()
export class TokenCandle {
  constructor(props?: Partial<TokenCandle>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Token, { nullable: true })
  token!: Token

  @Index_()
  @IntColumn_({ nullable: false })
  chainId!: number

  @Index_()
  @Column_('varchar', { length: 9, nullable: false })
  interval!: CandleInterval

  @Index_()
  @DateTimeColumn_({ nullable: false })
  periodStart!: Date

  @StringColumn_({ nullable: false })
  open!: string

  @StringColumn_({ nullable: false })
  high!: string

  @StringColumn_({ nullable: false })
  low!: string

  @StringColumn_({ nullable: false })
  close!: string

  @BigIntColumn_({ nullable: false })
  volume!: bigint

  @StringColumn_({ nullable: false })
  volumeUSD!: string

  @IntColumn_({ nullable: false })
  txCount!: number

  @IntColumn_({ nullable: false })
  buyCount!: number

  @IntColumn_({ nullable: false })
  sellCount!: number

  @StringColumn_({ nullable: false })
  priceChange!: string

  @IntColumn_({ nullable: false })
  priceChangeBps!: number

  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
