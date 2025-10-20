import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, BytesColumn as BytesColumn_, ManyToOne as ManyToOne_, Index as Index_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {IPFSFile} from "./ipfsFile.model"

@Entity_()
export class AgentProfile {
    constructor(props?: Partial<AgentProfile>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BigIntColumn_({nullable: false})
    agentId!: bigint

    @BytesColumn_({nullable: false})
    owner!: Uint8Array

    @Index_()
    @ManyToOne_(() => IPFSFile, {nullable: true})
    profileIPFS!: IPFSFile | undefined | null

    @IntColumn_({nullable: false})
    stakeTier!: number

    @DateTimeColumn_({nullable: false})
    registered!: Date

    @BooleanColumn_({nullable: false})
    isBanned!: boolean
}
