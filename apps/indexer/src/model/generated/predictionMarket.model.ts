import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { MarketPosition } from './marketPosition.model'
import { MarketTrade } from './marketTrade.model'

@Entity_()
export class PredictionMarket {
  constructor(props?: Partial<PredictionMarket>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  sessionId!: string

  @StringColumn_({ nullable: false })
  question!: string

  @BigIntColumn_({ nullable: false })
  liquidityB!: bigint

  @BigIntColumn_({ nullable: false })
  yesShares!: bigint

  @BigIntColumn_({ nullable: false })
  noShares!: bigint

  @BigIntColumn_({ nullable: false })
  totalVolume!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @Index_()
  @BooleanColumn_({ nullable: false })
  resolved!: boolean

  @BooleanColumn_({ nullable: true })
  outcome!: boolean | undefined | null

  @OneToMany_(
    () => MarketTrade,
    (e) => e.market,
  )
  trades!: MarketTrade[]

  @OneToMany_(
    () => MarketPosition,
    (e) => e.market,
  )
  positions!: MarketPosition[]
}
