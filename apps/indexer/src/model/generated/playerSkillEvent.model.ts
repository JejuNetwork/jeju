import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class PlayerSkillEvent {
  constructor(props?: Partial<PlayerSkillEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  player!: string

  @StringColumn_({ nullable: false })
  skillName!: string

  @IntColumn_({ nullable: false })
  newLevel!: number

  @BigIntColumn_({ nullable: false })
  totalXp!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
