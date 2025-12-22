import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { PredictionMarket } from './predictionMarket.model'

@Entity_()
export class MarketPosition {
  constructor(props?: Partial<MarketPosition>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => PredictionMarket, { nullable: true })
  market!: PredictionMarket

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  trader!: Account

  @BigIntColumn_({ nullable: false })
  yesShares!: bigint

  @BigIntColumn_({ nullable: false })
  noShares!: bigint

  @BigIntColumn_({ nullable: false })
  totalSpent!: bigint

  @BigIntColumn_({ nullable: false })
  totalReceived!: bigint

  @BooleanColumn_({ nullable: false })
  hasClaimed!: boolean

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
