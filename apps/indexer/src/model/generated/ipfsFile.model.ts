import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BytesColumn as BytesColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_, ManyToOne as ManyToOne_} from "@subsquid/typeorm-store"
import {FileCategory} from "./_fileCategory"
import {ModerationReport} from "./moderationReport.model"
import {TEEAttestation} from "./teeAttestation.model"
import {NFTMetadata} from "./nftMetadata.model"
import {AgentProfile} from "./agentProfile.model"
import {ContestResult} from "./contestResult.model"

@Entity_()
export class IPFSFile {
    constructor(props?: Partial<IPFSFile>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    cid!: string

    @Index_()
    @BytesColumn_({nullable: false})
    owner!: Uint8Array

    @BigIntColumn_({nullable: false})
    sizeBytes!: bigint

    @BigIntColumn_({nullable: false})
    paidAmount!: bigint

    @BytesColumn_({nullable: false})
    paymentToken!: Uint8Array

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    expiresAt!: Date

    @BooleanColumn_({nullable: false})
    isPinned!: boolean

    @Index_()
    @Column_("varchar", {length: 19, nullable: false})
    category!: FileCategory

    @Index_()
    @BytesColumn_({nullable: true})
    relatedContract!: Uint8Array | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    relatedEntityId!: string | undefined | null

    @StringColumn_({nullable: true})
    filename!: string | undefined | null

    @StringColumn_({nullable: true})
    mimeType!: string | undefined | null

    @Index_()
    @ManyToOne_(() => ModerationReport, {nullable: true})
    moderationReport!: ModerationReport | undefined | null

    @Index_()
    @ManyToOne_(() => TEEAttestation, {nullable: true})
    teeAttestation!: TEEAttestation | undefined | null

    @Index_()
    @ManyToOne_(() => NFTMetadata, {nullable: true})
    nftMetadata!: NFTMetadata | undefined | null

    @Index_()
    @ManyToOne_(() => AgentProfile, {nullable: true})
    agentProfile!: AgentProfile | undefined | null

    @Index_()
    @ManyToOne_(() => ContestResult, {nullable: true})
    contestResult!: ContestResult | undefined | null
}
