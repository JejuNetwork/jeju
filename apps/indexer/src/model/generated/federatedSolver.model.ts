import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class FederatedSolver {
  constructor(props?: Partial<FederatedSolver>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  solver!: string

  @Index_()
  @BigIntColumn_({ nullable: false })
  chainId!: bigint

  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @BigIntColumn_({ nullable: false })
  totalFills!: bigint

  @BigIntColumn_({ nullable: false })
  totalVolume!: bigint

  @DateTimeColumn_({ nullable: false })
  registeredAt!: Date
}
