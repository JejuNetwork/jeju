import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { KeepaliveStatus } from './_keepaliveStatus'
import { Account } from './account.model'
import { KeepaliveHealthCheck } from './keepaliveHealthCheck.model'
import { KeepaliveResource } from './keepaliveResource.model'

@Entity_()
export class Keepalive {
  constructor(props?: Partial<Keepalive>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  owner!: Account

  @Index_()
  @StringColumn_({ nullable: false })
  jnsNode!: string

  @BigIntColumn_({ nullable: true })
  agentId!: bigint | undefined | null

  @Index_()
  @StringColumn_({ nullable: false })
  vaultAddress!: string

  @BigIntColumn_({ nullable: false })
  globalMinBalance!: bigint

  @IntColumn_({ nullable: false })
  checkInterval!: number

  @BigIntColumn_({ nullable: false })
  autoFundAmount!: bigint

  @BooleanColumn_({ nullable: false })
  autoFundEnabled!: boolean

  @BooleanColumn_({ nullable: false })
  active!: boolean

  @Column_('varchar', { length: 9, nullable: false })
  status!: KeepaliveStatus

  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @DateTimeColumn_({ nullable: true })
  lastCheckAt!: Date | undefined | null

  @DateTimeColumn_({ nullable: true })
  lastHealthy!: Date | undefined | null

  @BigIntColumn_({ nullable: false })
  totalAutoFunded!: bigint

  @IntColumn_({ nullable: false })
  healthCheckCount!: number

  @OneToMany_(
    () => KeepaliveResource,
    (e) => e.keepalive,
  )
  resources!: KeepaliveResource[]

  @OneToMany_(
    () => KeepaliveHealthCheck,
    (e) => e.keepalive,
  )
  healthChecks!: KeepaliveHealthCheck[]
}
