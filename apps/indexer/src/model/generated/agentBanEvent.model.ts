import {
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { RegisteredAgent } from './registeredAgent.model'

@Entity_()
export class AgentBanEvent {
  constructor(props?: Partial<AgentBanEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  agent!: RegisteredAgent

  @BooleanColumn_({ nullable: false })
  isBan!: boolean

  @StringColumn_({ nullable: false })
  banType!: string

  @StringColumn_({ nullable: true })
  appId!: string | undefined | null

  @StringColumn_({ nullable: true })
  reason!: string | undefined | null

  @StringColumn_({ nullable: true })
  proposalId!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
