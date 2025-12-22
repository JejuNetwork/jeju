import {
  BigIntColumn as BigIntColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { RegisteredAgent } from './registeredAgent.model'

@Entity_()
export class RegistryStake {
  constructor(props?: Partial<RegistryStake>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  agent!: RegisteredAgent

  @StringColumn_({ nullable: false })
  token!: string

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @BigIntColumn_({ nullable: false })
  depositedAt!: bigint

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
