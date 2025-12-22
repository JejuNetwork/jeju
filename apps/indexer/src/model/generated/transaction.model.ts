import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { TransactionStatus } from './_transactionStatus'
import { Account } from './account.model'
import { Block } from './block.model'
import { Log } from './log.model'
import { Trace } from './trace.model'

@Entity_()
export class Transaction {
  constructor(props?: Partial<Transaction>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  hash!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  from!: Account

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  to!: Account | undefined | null

  @Index_()
  @ManyToOne_(() => Block, { nullable: true })
  block!: Block

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number

  @IntColumn_({ nullable: false })
  transactionIndex!: number

  @BigIntColumn_({ nullable: false })
  value!: bigint

  @BigIntColumn_({ nullable: true })
  gasPrice!: bigint | undefined | null

  @BigIntColumn_({ nullable: false })
  gasLimit!: bigint

  @BigIntColumn_({ nullable: true })
  gasUsed!: bigint | undefined | null

  @StringColumn_({ nullable: true })
  input!: string | undefined | null

  @IntColumn_({ nullable: false })
  nonce!: number

  @Column_('varchar', { length: 7, nullable: false })
  status!: TransactionStatus

  @IntColumn_({ nullable: true })
  type!: number | undefined | null

  @BigIntColumn_({ nullable: true })
  maxFeePerGas!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  maxPriorityFeePerGas!: bigint | undefined | null

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  contractAddress!: Account | undefined | null

  @OneToMany_(
    () => Log,
    (e) => e.transaction,
  )
  logs!: Log[]

  @OneToMany_(
    () => Trace,
    (e) => e.transaction,
  )
  traces!: Trace[]
}
