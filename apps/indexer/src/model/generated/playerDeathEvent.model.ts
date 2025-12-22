import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class PlayerDeathEvent {
  constructor(props?: Partial<PlayerDeathEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  player!: string

  @Index_()
  @StringColumn_({ nullable: true })
  killer!: string | undefined | null

  @StringColumn_({ nullable: false })
  location!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
