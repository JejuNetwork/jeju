import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { OIFOracleType } from './_oifOracleType'
import { OIFIntent } from './oifIntent.model'
import { OIFSettlement } from './oifSettlement.model'

@Entity_()
export class OIFAttestation {
  constructor(props?: Partial<OIFAttestation>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  attestationId!: string

  @Index_()
  @ManyToOne_(() => OIFIntent, { nullable: true })
  intent!: OIFIntent

  @Index_()
  @StringColumn_({ nullable: false })
  orderId!: string

  @Column_('varchar', { length: 15, nullable: false })
  oracleType!: OIFOracleType

  @IntColumn_({ nullable: false })
  sourceChainId!: number

  @IntColumn_({ nullable: false })
  destinationChainId!: number

  @StringColumn_({ nullable: false })
  proof!: string

  @BigIntColumn_({ nullable: false })
  proofBlockNumber!: bigint

  @DateTimeColumn_({ nullable: false })
  proofTimestamp!: Date

  @BooleanColumn_({ nullable: false })
  verified!: boolean

  @DateTimeColumn_({ nullable: true })
  verifiedAt!: Date | undefined | null

  @StringColumn_({ nullable: true })
  verificationTx!: string | undefined | null

  @Index_()
  @ManyToOne_(() => OIFSettlement, { nullable: true })
  settlement!: OIFSettlement | undefined | null
}
