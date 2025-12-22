import {
  BigIntColumn as BigIntColumn_,
  BytesColumn as BytesColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { CouncilProposal } from './councilProposal.model'

@Entity_()
export class VetoVote {
  constructor(props?: Partial<VetoVote>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => CouncilProposal, { nullable: true })
  proposal!: CouncilProposal

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  voter!: Account

  @BigIntColumn_({ nullable: true })
  agentId!: bigint | undefined | null

  @StringColumn_({ nullable: false })
  category!: string

  @BytesColumn_({ nullable: false })
  reasonHash!: Uint8Array

  @BigIntColumn_({ nullable: false })
  stakedAmount!: bigint

  @BigIntColumn_({ nullable: false })
  reputationWeight!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  votedAt!: Date
}
