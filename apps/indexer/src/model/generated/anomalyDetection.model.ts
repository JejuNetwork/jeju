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
import { ProtectedContract } from './protectedContract.model'

@Entity_()
export class AnomalyDetection {
  constructor(props?: Partial<AnomalyDetection>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => ProtectedContract, { nullable: true })
  target!: ProtectedContract

  @StringColumn_({ nullable: false })
  anomalyType!: string

  @BigIntColumn_({ nullable: false })
  value!: bigint

  @BigIntColumn_({ nullable: false })
  threshold!: bigint

  @BooleanColumn_({ nullable: false })
  autoPaused!: boolean

  @Index_()
  @DateTimeColumn_({ nullable: false })
  detectedAt!: Date

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
