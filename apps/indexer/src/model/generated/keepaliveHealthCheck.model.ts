import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { KeepaliveStatus } from './_keepaliveStatus'
import { Keepalive } from './keepalive.model'

@Entity_()
export class KeepaliveHealthCheck {
  constructor(props?: Partial<KeepaliveHealthCheck>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Keepalive, { nullable: true })
  keepalive!: Keepalive

  @Column_('varchar', { length: 9, nullable: false })
  status!: KeepaliveStatus

  @BigIntColumn_({ nullable: false })
  balance!: bigint

  @IntColumn_({ nullable: false })
  healthyResources!: number

  @IntColumn_({ nullable: false })
  totalResources!: number

  @StringColumn_({ array: true, nullable: false })
  failedResources!: string[]

  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number

  @Index_()
  @StringColumn_({ nullable: false })
  txHash!: string
}
