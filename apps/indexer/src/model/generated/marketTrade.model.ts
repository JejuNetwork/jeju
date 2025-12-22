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
export class MarketTrade {
  constructor(props?: Partial<MarketTrade>) {
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

  @BooleanColumn_({ nullable: false })
  outcome!: boolean

  @BooleanColumn_({ nullable: false })
  isBuy!: boolean

  @BigIntColumn_({ nullable: false })
  shares!: bigint

  @BigIntColumn_({ nullable: false })
  cost!: bigint

  @BigIntColumn_({ nullable: false })
  priceAfter!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date
}
