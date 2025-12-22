import {
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
export class AgentMetadata {
  constructor(props?: Partial<AgentMetadata>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  agent!: RegisteredAgent

  @StringColumn_({ nullable: false })
  key!: string

  @StringColumn_({ nullable: false })
  value!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  updatedAt!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
