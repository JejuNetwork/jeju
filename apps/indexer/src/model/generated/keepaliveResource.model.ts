import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { KeepaliveResourceType } from './_keepaliveResourceType'
import { Keepalive } from './keepalive.model'

@Entity_()
export class KeepaliveResource {
  constructor(props?: Partial<KeepaliveResource>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Keepalive, { nullable: true })
  keepalive!: Keepalive

  @Column_('varchar', { length: 16, nullable: false })
  resourceType!: KeepaliveResourceType

  @StringColumn_({ nullable: false })
  identifier!: string

  @StringColumn_({ nullable: true })
  healthEndpoint!: string | undefined | null

  @BigIntColumn_({ nullable: false })
  minBalance!: bigint

  @BooleanColumn_({ nullable: false })
  required!: boolean

  @DateTimeColumn_({ nullable: false })
  addedAt!: Date
}
