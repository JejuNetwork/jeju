import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { Delegation } from './delegation.model'

@Entity_()
export class Delegate {
  constructor(props?: Partial<Delegate>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  delegate!: Account

  @BigIntColumn_({ nullable: true })
  agentId!: bigint | undefined | null

  @StringColumn_({ nullable: false })
  name!: string

  @StringColumn_({ nullable: true })
  profileHash!: string | undefined | null

  @StringColumn_({ array: true, nullable: false })
  expertise!: string[]

  @BigIntColumn_({ nullable: false })
  totalDelegated!: bigint

  @IntColumn_({ nullable: false })
  delegatorCount!: number

  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @Index_()
  @BooleanColumn_({ nullable: false })
  isSecurityCouncil!: boolean

  @IntColumn_({ nullable: false })
  proposalsVoted!: number

  @IntColumn_({ nullable: false })
  proposalsCreated!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  registeredAt!: Date

  @OneToMany_(
    () => Delegation,
    (e) => e.delegate,
  )
  delegations!: Delegation[]
}
