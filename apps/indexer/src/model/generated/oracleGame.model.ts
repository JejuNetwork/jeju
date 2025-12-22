import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { PredictionMarket } from './predictionMarket.model'

@Entity_()
export class OracleGame {
  constructor(props?: Partial<OracleGame>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  sessionId!: string

  @StringColumn_({ nullable: false })
  question!: string

  @StringColumn_({ nullable: false })
  commitment!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  committedAt!: Date

  @Index_()
  @BooleanColumn_({ nullable: false })
  finalized!: boolean

  @DateTimeColumn_({ nullable: true })
  revealedAt!: Date | undefined | null

  @BooleanColumn_({ nullable: true })
  outcome!: boolean | undefined | null

  @StringColumn_({ array: true, nullable: false })
  winners!: string[]

  @BigIntColumn_({ nullable: false })
  totalPayout!: bigint

  @Index_()
  @ManyToOne_(() => PredictionMarket, { nullable: true })
  market!: PredictionMarket | undefined | null
}
