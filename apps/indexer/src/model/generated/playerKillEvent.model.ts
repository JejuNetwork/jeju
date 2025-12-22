import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class PlayerKillEvent {
  constructor(props?: Partial<PlayerKillEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  killer!: string

  @Index_()
  @StringColumn_({ nullable: false })
  victim!: string

  @StringColumn_({ nullable: false })
  method!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
