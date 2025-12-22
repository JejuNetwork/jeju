import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

/**
 * Global token market stats - aggregated across all chains.
 */
@Entity_()
export class TokenMarketStats {
  constructor(props?: Partial<TokenMarketStats>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @DateTimeColumn_({ nullable: true })
  date!: Date | undefined | null

  @Index_()
  @IntColumn_({ nullable: true })
  chainId!: number | undefined | null

  @IntColumn_({ nullable: false })
  totalTokens!: number

  @IntColumn_({ nullable: false })
  activeTokens24h!: number

  @IntColumn_({ nullable: false })
  totalPools!: number

  @IntColumn_({ nullable: false })
  activePools24h!: number

  @StringColumn_({ nullable: false })
  totalVolumeUSD24h!: string

  @StringColumn_({ nullable: false })
  totalLiquidityUSD!: string

  @IntColumn_({ nullable: false })
  totalSwaps24h!: number

  @StringColumn_({ array: true, nullable: false })
  topGainers!: string[]

  @StringColumn_({ array: true, nullable: false })
  topLosers!: string[]

  @StringColumn_({ array: true, nullable: false })
  trending!: string[]

  @StringColumn_({ array: true, nullable: false })
  newTokens24h!: string[]

  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
