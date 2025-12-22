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
import { Delegate } from './delegate.model'

@Entity_()
export class Delegation {
  constructor(props?: Partial<Delegation>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  delegator!: Account

  @Index_()
  @ManyToOne_(() => Delegate, { nullable: true })
  delegate!: Delegate

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @DateTimeColumn_({ nullable: true })
  lockedUntil!: Date | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  delegatedAt!: Date

  @DateTimeColumn_({ nullable: true })
  revokedAt!: Date | undefined | null

  @Index_()
  @BooleanColumn_({ nullable: false })
  active!: boolean
}
