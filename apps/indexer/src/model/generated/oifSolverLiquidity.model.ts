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
import { OIFSolver } from './oifSolver.model'

@Entity_()
export class OIFSolverLiquidity {
  constructor(props?: Partial<OIFSolverLiquidity>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => OIFSolver, { nullable: true })
  solver!: OIFSolver

  @Index_()
  @IntColumn_({ nullable: false })
  chainId!: number

  @Index_()
  @StringColumn_({ nullable: false })
  token!: string

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @BigIntColumn_({ nullable: false })
  lockedAmount!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
