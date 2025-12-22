import {
  BigIntColumn as BigIntColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { NodeStake } from './nodeStake.model'

@Entity_()
export class RewardClaim {
  constructor(props?: Partial<RewardClaim>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => NodeStake, { nullable: true })
  node!: NodeStake

  @StringColumn_({ nullable: false })
  operator!: string

  @StringColumn_({ nullable: false })
  rewardToken!: string

  @BigIntColumn_({ nullable: false })
  rewardAmount!: bigint

  @BigIntColumn_({ nullable: false })
  paymasterFeesETH!: bigint

  @BigIntColumn_({ nullable: false })
  timestamp!: bigint

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
