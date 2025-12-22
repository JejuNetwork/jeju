import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { AgentFeedback } from './agentFeedback.model'

@Entity_()
export class FeedbackResponse {
  constructor(props?: Partial<FeedbackResponse>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => AgentFeedback, { nullable: true })
  feedback!: AgentFeedback

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  responder!: Account

  @StringColumn_({ nullable: false })
  responseUri!: string

  @StringColumn_({ nullable: true })
  responseHash!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
