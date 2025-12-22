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
export class GameMarketUpdate {
  constructor(props?: Partial<GameMarketUpdate>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  sessionId!: string

  @IntColumn_({ nullable: false })
  yesOdds!: number

  @IntColumn_({ nullable: false })
  noOdds!: number

  @BigIntColumn_({ nullable: false })
  totalVolume!: bigint

  @IntColumn_({ nullable: false })
  gameDay!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
