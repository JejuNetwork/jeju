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
import { RegisteredAgent } from './registeredAgent.model'

@Entity_()
export class AgentSlashEvent {
  constructor(props?: Partial<AgentSlashEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  agent!: RegisteredAgent

  @BigIntColumn_({ nullable: false })
  slashAmount!: bigint

  @StringColumn_({ nullable: false })
  reason!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
