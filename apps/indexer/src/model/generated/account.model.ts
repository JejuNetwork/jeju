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
import { Contract } from './contract.model'
import { TokenBalance } from './tokenBalance.model'
import { TokenTransfer } from './tokenTransfer.model'
import { Transaction } from './transaction.model'

@Entity_()
export class Account {
  constructor(props?: Partial<Account>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  address!: string

  @BooleanColumn_({ nullable: false })
  isContract!: boolean

  @Index_()
  @IntColumn_({ nullable: false })
  firstSeenBlock!: number

  @Index_()
  @IntColumn_({ nullable: false })
  lastSeenBlock!: number

  @IntColumn_({ nullable: false })
  transactionCount!: number

  @BigIntColumn_({ nullable: false })
  totalValueSent!: bigint

  @BigIntColumn_({ nullable: false })
  totalValueReceived!: bigint

  @StringColumn_({ array: true, nullable: false })
  labels!: string[]

  @Index_()
  @ManyToOne_(() => Contract, { nullable: true })
  contract!: Contract | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  firstSeenAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastSeenAt!: Date

  @OneToMany_(
    () => Transaction,
    (e) => e.from,
  )
  sentTransactions!: Transaction[]

  @OneToMany_(
    () => Transaction,
    (e) => e.to,
  )
  receivedTransactions!: Transaction[]

  @OneToMany_(
    () => TokenBalance,
    (e) => e.account,
  )
  tokenBalances!: TokenBalance[]

  @OneToMany_(
    () => Contract,
    (e) => e.creator,
  )
  createdContracts!: Contract[]

  @OneToMany_(
    () => TokenTransfer,
    (e) => e.from,
  )
  tokenTransfersFrom!: TokenTransfer[]

  @OneToMany_(
    () => TokenTransfer,
    (e) => e.to,
  )
  tokenTransfersTo!: TokenTransfer[]
}
