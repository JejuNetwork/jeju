import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BytesColumn as BytesColumn_, ManyToOne as ManyToOne_, Index as Index_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {IPFSFile} from "./ipfsFile.model"
import {GameType} from "./_gameType"

@Entity_()
export class TEEAttestation {
    constructor(props?: Partial<TEEAttestation>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BytesColumn_({nullable: false})
    sessionId!: Uint8Array

    @Index_()
    @ManyToOne_(() => IPFSFile, {nullable: true})
    attestationIPFS!: IPFSFile | undefined | null

    @BytesColumn_({nullable: false})
    contentHash!: Uint8Array

    @Column_("varchar", {length: 10, nullable: false})
    gameType!: GameType

    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @BooleanColumn_({nullable: false})
    verified!: boolean
}
