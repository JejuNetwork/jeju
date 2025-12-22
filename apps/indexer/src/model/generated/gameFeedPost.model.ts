import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class GameFeedPost {
  constructor(props?: Partial<GameFeedPost>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  sessionId!: string

  @Index_()
  @StringColumn_({ nullable: false })
  postId!: string

  @Index_()
  @StringColumn_({ nullable: false })
  author!: string

  @StringColumn_({ nullable: false })
  content!: string

  @IntColumn_({ nullable: false })
  gameDay!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BooleanColumn_({ nullable: false })
  isSystemMessage!: boolean

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
