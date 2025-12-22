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
import { OIFSolver } from './oifSolver.model'

@Entity_()
export class OIFSlashEvent {
  constructor(props?: Partial<OIFSlashEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => OIFSolver, { nullable: true })
  solver!: OIFSolver

  @Index_()
  @StringColumn_({ nullable: false })
  intentId!: string

  @StringColumn_({ nullable: false })
  orderId!: string

  @IntColumn_({ nullable: false })
  chainId!: number

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @StringColumn_({ nullable: false })
  victim!: string

  @StringColumn_({ nullable: false })
  reason!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BooleanColumn_({ nullable: false })
  disputed!: boolean

  @StringColumn_({ nullable: false })
  txHash!: string
}
