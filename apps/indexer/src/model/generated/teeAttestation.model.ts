import {
  BooleanColumn as BooleanColumn_,
  BytesColumn as BytesColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'
import type { GameType } from './_gameType'
import { IPFSFile } from './ipfsFile.model'

@Entity_()
export class TEEAttestation {
  constructor(props?: Partial<TEEAttestation>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @BytesColumn_({ nullable: false })
  sessionId!: Uint8Array

  @Index_()
  @ManyToOne_(() => IPFSFile, { nullable: true })
  attestationIPFS!: IPFSFile | undefined | null

  @BytesColumn_({ nullable: false })
  contentHash!: Uint8Array

  @Column_('varchar', { length: 10, nullable: false })
  gameType!: GameType

  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BooleanColumn_({ nullable: false })
  verified!: boolean
}
