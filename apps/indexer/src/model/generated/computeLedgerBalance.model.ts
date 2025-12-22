import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'

@Entity_()
export class ComputeLedgerBalance {
  constructor(props?: Partial<ComputeLedgerBalance>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  account!: Account

  @Index_()
  @StringColumn_({ nullable: false })
  token!: string

  @BigIntColumn_({ nullable: false })
  balance!: bigint

  @BigIntColumn_({ nullable: false })
  lockedAmount!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
