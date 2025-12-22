import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  BytesColumn as BytesColumn_,
  Entity as Entity_,
  Index as Index_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { GovernanceEvent } from './governanceEvent.model'

@Entity_()
export class GovernanceProposal {
  constructor(props?: Partial<GovernanceProposal>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @BytesColumn_({ nullable: false })
  proposalId!: Uint8Array

  @StringColumn_({ nullable: false })
  parameter!: string

  @BigIntColumn_({ nullable: false })
  currentValue!: bigint

  @BigIntColumn_({ nullable: false })
  proposedValue!: bigint

  @BytesColumn_({ nullable: false })
  changeMarketId!: Uint8Array

  @BytesColumn_({ nullable: false })
  statusQuoMarketId!: Uint8Array

  @BigIntColumn_({ nullable: false })
  createdAt!: bigint

  @BigIntColumn_({ nullable: false })
  votingEnds!: bigint

  @BigIntColumn_({ nullable: false })
  executeAfter!: bigint

  @BooleanColumn_({ nullable: false })
  executed!: boolean

  @BooleanColumn_({ nullable: false })
  vetoed!: boolean

  @StringColumn_({ nullable: false })
  proposer!: string

  @OneToMany_(
    () => GovernanceEvent,
    (e) => e.proposal,
  )
  events!: GovernanceEvent[]
}
