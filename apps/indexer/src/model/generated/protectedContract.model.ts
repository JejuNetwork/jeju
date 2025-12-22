import {
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { Account } from './account.model'

@Entity_()
export class ProtectedContract {
  constructor(props?: Partial<ProtectedContract>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  target!: Account

  @StringColumn_({ nullable: false })
  name!: string

  @IntColumn_({ nullable: false })
  priority!: number

  @Index_()
  @BooleanColumn_({ nullable: false })
  isPaused!: boolean

  @DateTimeColumn_({ nullable: true })
  pausedAt!: Date | undefined | null

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  pausedBy!: Account | undefined | null

  @StringColumn_({ nullable: true })
  pauseReason!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  registeredAt!: Date
}
