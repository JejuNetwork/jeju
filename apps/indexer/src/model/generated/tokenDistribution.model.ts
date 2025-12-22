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
export class TokenDistribution {
  constructor(props?: Partial<TokenDistribution>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  token!: string

  @BigIntColumn_({ nullable: false })
  totalStaked!: bigint

  @IntColumn_({ nullable: false })
  totalNodes!: number

  @BigIntColumn_({ nullable: false })
  averageStake!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
