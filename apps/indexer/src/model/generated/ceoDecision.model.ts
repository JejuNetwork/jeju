import {
  BooleanColumn as BooleanColumn_,
  BytesColumn as BytesColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { CouncilProposal } from './councilProposal.model'

@Entity_()
export class CEODecision {
  constructor(props?: Partial<CEODecision>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => CouncilProposal, { nullable: true })
  proposal!: CouncilProposal

  @StringColumn_({ nullable: false })
  modelId!: string

  @BooleanColumn_({ nullable: false })
  approved!: boolean

  @BytesColumn_({ nullable: false })
  decisionHash!: Uint8Array

  @BytesColumn_({ nullable: false })
  encryptedHash!: Uint8Array

  @BytesColumn_({ nullable: false })
  contextHash!: Uint8Array

  @IntColumn_({ nullable: false })
  confidenceScore!: number

  @IntColumn_({ nullable: false })
  alignmentScore!: number

  @BooleanColumn_({ nullable: false })
  disputed!: boolean

  @BooleanColumn_({ nullable: false })
  overridden!: boolean

  @Index_()
  @DateTimeColumn_({ nullable: false })
  decidedAt!: Date

  @IntColumn_({ nullable: false })
  blockNumber!: number

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
