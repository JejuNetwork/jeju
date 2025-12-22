import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { PerpMarket } from './perpMarket.model'
import { PerpPosition } from './perpPosition.model'

@Entity_()
export class PerpFundingPayment {
  constructor(props?: Partial<PerpFundingPayment>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => PerpMarket, { nullable: true })
  market!: PerpMarket

  @Index_()
  @ManyToOne_(() => PerpPosition, { nullable: true })
  position!: PerpPosition

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  trader!: Account

  @BigIntColumn_({ nullable: false })
  fundingRate!: bigint

  @BigIntColumn_({ nullable: false })
  payment!: bigint

  @BooleanColumn_({ nullable: false })
  isPayment!: boolean

  @BigIntColumn_({ nullable: false })
  positionSize!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
