import {
  BigIntColumn as BigIntColumn_,
  BytesColumn as BytesColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'
import { IPFSFile } from './ipfsFile.model'

@Entity_()
export class NFTMetadata {
  constructor(props?: Partial<NFTMetadata>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @BigIntColumn_({ nullable: false })
  tokenId!: bigint

  @BytesColumn_({ nullable: false })
  contract!: Uint8Array

  @Index_()
  @ManyToOne_(() => IPFSFile, { nullable: true })
  metadataIPFS!: IPFSFile | undefined | null

  @BytesColumn_({ nullable: false })
  owner!: Uint8Array

  @DateTimeColumn_({ nullable: false })
  mintedAt!: Date
}
