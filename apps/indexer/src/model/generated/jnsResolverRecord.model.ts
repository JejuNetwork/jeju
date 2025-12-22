import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { JNSName } from './jnsName.model'

@Entity_()
export class JNSResolverRecord {
  constructor(props?: Partial<JNSResolverRecord>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => JNSName, { nullable: true })
  name!: JNSName

  @Index_()
  @StringColumn_({ nullable: false })
  key!: string

  @StringColumn_({ nullable: false })
  value!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string
}
