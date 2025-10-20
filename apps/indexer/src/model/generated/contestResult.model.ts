import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BytesColumn as BytesColumn_, ManyToOne as ManyToOne_, Index as Index_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {IPFSFile} from "./ipfsFile.model"

@Entity_()
export class ContestResult {
    constructor(props?: Partial<ContestResult>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BytesColumn_({nullable: false})
    contestId!: Uint8Array

    @Index_()
    @ManyToOne_(() => IPFSFile, {nullable: true})
    resultsIPFS!: IPFSFile | undefined | null

    @IntColumn_({nullable: false})
    winner!: number

    @DateTimeColumn_({nullable: false})
    finalized!: Date
}
