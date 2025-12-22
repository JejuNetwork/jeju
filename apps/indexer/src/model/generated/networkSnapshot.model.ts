import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class NetworkSnapshot {
  constructor(props?: Partial<NetworkSnapshot>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @IntColumn_({ nullable: false })
  totalNodes!: number

  @IntColumn_({ nullable: false })
  activeNodes!: number

  @BigIntColumn_({ nullable: false })
  totalStaked!: bigint

  @BigIntColumn_({ nullable: false })
  totalStakedUSD!: bigint

  @BigIntColumn_({ nullable: false })
  averageUptime!: bigint
}
