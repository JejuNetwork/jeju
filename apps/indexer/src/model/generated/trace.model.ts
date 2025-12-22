import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { TraceType } from './_traceType'
import { Account } from './account.model'
import { Transaction } from './transaction.model'

@Entity_()
export class Trace {
  constructor(props?: Partial<Trace>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Column_('varchar', { length: 12, nullable: false })
  type!: TraceType

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  from!: Account

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  to!: Account | undefined | null

  @BigIntColumn_({ nullable: true })
  value!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  gas!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  gasUsed!: bigint | undefined | null

  @StringColumn_({ nullable: true })
  input!: string | undefined | null

  @StringColumn_({ nullable: true })
  output!: string | undefined | null

  @StringColumn_({ nullable: true })
  error!: string | undefined | null

  @Index_()
  @ManyToOne_(() => Transaction, { nullable: true })
  transaction!: Transaction

  @IntColumn_({ array: true, nullable: false })
  traceAddress!: number[]
}
