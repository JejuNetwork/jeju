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
export class GamePhaseChange {
  constructor(props?: Partial<GamePhaseChange>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  sessionId!: string

  @StringColumn_({ nullable: false })
  phase!: string

  @IntColumn_({ nullable: false })
  day!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
