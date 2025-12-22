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
export class EILChainStats {
  constructor(props?: Partial<EILChainStats>) {
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
  paymasterAddress!: string

  @BigIntColumn_({ nullable: false })
  totalVolume!: bigint

  @BigIntColumn_({ nullable: false })
  totalTransfers!: bigint

  @IntColumn_({ nullable: false })
  activeXLPs!: number

  @BigIntColumn_({ nullable: false })
  totalLiquidity!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
