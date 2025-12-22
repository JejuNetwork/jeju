import {
  BigIntColumn as BigIntColumn_,
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
export class PerpCollateralWithdrawal {
  constructor(props?: Partial<PerpCollateralWithdrawal>) {
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

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @Index_()
  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
