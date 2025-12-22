import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  BytesColumn as BytesColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'
import { IPFSFile } from './ipfsFile.model'

@Entity_()
export class AgentProfile {
  constructor(props?: Partial<AgentProfile>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @BigIntColumn_({ nullable: false })
  agentId!: bigint

  @BytesColumn_({ nullable: false })
  owner!: Uint8Array

  @Index_()
  @ManyToOne_(() => IPFSFile, { nullable: true })
  profileIPFS!: IPFSFile | undefined | null

  @IntColumn_({ nullable: false })
  stakeTier!: number

  @DateTimeColumn_({ nullable: false })
  registered!: Date

  @BooleanColumn_({ nullable: false })
  isBanned!: boolean
}
