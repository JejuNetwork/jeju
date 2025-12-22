import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  JSONColumn as JSONColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'
import { JNSListing } from './jnsListing.model'
import { JNSRenewal } from './jnsRenewal.model'
import { JNSTransfer } from './jnsTransfer.model'
import { RegisteredAgent } from './registeredAgent.model'

@Entity_()
export class JNSName {
  constructor(props?: Partial<JNSName>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  name!: string

  @Index_()
  @StringColumn_({ nullable: false })
  labelhash!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  node!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  owner!: Account

  @StringColumn_({ nullable: true })
  resolver!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  registeredAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: false })
  expiresAt!: Date

  @BigIntColumn_({ nullable: false })
  registrationCost!: bigint

  @Index_()
  @BooleanColumn_({ nullable: false })
  isExpired!: boolean

  @BooleanColumn_({ nullable: false })
  inGracePeriod!: boolean

  @StringColumn_({ nullable: true })
  resolvedAddress!: string | undefined | null

  @StringColumn_({ nullable: true })
  contenthash!: string | undefined | null

  @BigIntColumn_({ nullable: true })
  linkedAgentId!: bigint | undefined | null

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  linkedAgent!: RegisteredAgent | undefined | null

  @StringColumn_({ nullable: true })
  appContract!: string | undefined | null

  @StringColumn_({ nullable: true })
  appId!: string | undefined | null

  @StringColumn_({ nullable: true })
  appEndpoint!: string | undefined | null

  @StringColumn_({ nullable: true })
  appA2AEndpoint!: string | undefined | null

  /**
   * ENS-style text records as key-value string pairs
   * Keys are record names (e.g., 'url', 'avatar', 'com.twitter')
   * Values are the corresponding text values
   */
  @JSONColumn_({ nullable: true })
  textRecords!: Record<string, string> | undefined | null

  @BooleanColumn_({ nullable: false })
  isListed!: boolean

  @Index_()
  @ManyToOne_(() => JNSListing, { nullable: true })
  currentListing!: JNSListing | undefined | null

  @IntColumn_({ nullable: false })
  transferCount!: number

  @IntColumn_({ nullable: false })
  renewalCount!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date

  @OneToMany_(
    () => JNSTransfer,
    (e) => e.name,
  )
  transfers!: JNSTransfer[]

  @OneToMany_(
    () => JNSRenewal,
    (e) => e.name,
  )
  renewals!: JNSRenewal[]

  @OneToMany_(
    () => JNSListing,
    (e) => e.name,
  )
  listings!: JNSListing[]
}
