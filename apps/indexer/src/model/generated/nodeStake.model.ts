import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { PerformanceUpdate } from './performanceUpdate.model'
import { RewardClaim } from './rewardClaim.model'

@Entity_()
export class NodeStake {
  constructor(props?: Partial<NodeStake>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  nodeId!: string

  @Index_()
  @StringColumn_({ nullable: false })
  operator!: string

  @StringColumn_({ nullable: false })
  stakedToken!: string

  @BigIntColumn_({ nullable: false })
  stakedAmount!: bigint

  @BigIntColumn_({ nullable: false })
  stakedValueUSD!: bigint

  @StringColumn_({ nullable: false })
  rewardToken!: string

  @BigIntColumn_({ nullable: false })
  totalRewardsClaimed!: bigint

  @BigIntColumn_({ nullable: false })
  lastClaimTime!: bigint

  @StringColumn_({ nullable: false })
  rpcUrl!: string

  @IntColumn_({ nullable: false })
  geographicRegion!: number

  @BigIntColumn_({ nullable: false })
  registrationTime!: bigint

  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @BooleanColumn_({ nullable: false })
  isSlashed!: boolean

  @BigIntColumn_({ nullable: true })
  currentUptimeScore!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  currentRequestsServed!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  currentAvgResponseTime!: bigint | undefined | null

  @OneToMany_(
    () => PerformanceUpdate,
    (e) => e.node,
  )
  performanceUpdates!: PerformanceUpdate[]

  @OneToMany_(
    () => RewardClaim,
    (e) => e.node,
  )
  rewardClaims!: RewardClaim[]
}
