import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class OIFChainStats {
  constructor(props?: Partial<OIFChainStats>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @IntColumn_({ nullable: false })
  chainId!: number

  @StringColumn_({ nullable: false })
  chainName!: string

  @StringColumn_({ nullable: false })
  inputSettlerAddress!: string

  @StringColumn_({ nullable: false })
  outputSettlerAddress!: string

  @StringColumn_({ nullable: true })
  solverRegistryAddress!: string | undefined | null

  @IntColumn_({ nullable: false })
  totalIntents!: number

  @BigIntColumn_({ nullable: false })
  totalVolume!: bigint

  @BigIntColumn_({ nullable: false })
  totalVolumeUsd!: bigint

  @IntColumn_({ nullable: false })
  activeSolvers!: number

  @BigIntColumn_({ nullable: false })
  totalLiquidity!: bigint

  @IntColumn_({ nullable: false })
  outboundIntents!: number

  @BigIntColumn_({ nullable: false })
  outboundVolume!: bigint

  @IntColumn_({ nullable: false })
  inboundIntents!: number

  @BigIntColumn_({ nullable: false })
  inboundVolume!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
