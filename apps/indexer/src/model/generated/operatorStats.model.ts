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
export class OperatorStats {
  constructor(props?: Partial<OperatorStats>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  operator!: string

  @IntColumn_({ nullable: false })
  totalNodes!: number

  @BigIntColumn_({ nullable: false })
  totalStaked!: bigint

  @BigIntColumn_({ nullable: false })
  totalRewardsClaimed!: bigint

  @BigIntColumn_({ nullable: false })
  averageUptime!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastActive!: Date
}
