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

@Entity_()
export class PerpCollateralDeposit {
  constructor(props?: Partial<PerpCollateralDeposit>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  trader!: Account

  @Index_()
  @StringColumn_({ nullable: false })
  token!: string

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @BooleanColumn_({ nullable: false })
  isCrossChain!: boolean

  @IntColumn_({ nullable: true })
  sourceChainId!: number | undefined | null

  @StringColumn_({ nullable: true })
  voucherId!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @Index_()
  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
