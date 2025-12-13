import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BytesColumn as BytesColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {CouncilProposal} from "./councilProposal.model"
import {Account} from "./account.model"

@Entity_()
export class CouncilVote {
    constructor(props?: Partial<CouncilVote>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => CouncilProposal, {nullable: true})
    proposal!: CouncilProposal

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    councilAgent!: Account

    @StringColumn_({nullable: false})
    role!: string

    @StringColumn_({nullable: false})
    vote!: string

    @BytesColumn_({nullable: false})
    reasoningHash!: Uint8Array

    @BigIntColumn_({nullable: false})
    weight!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    votedAt!: Date

    @IntColumn_({nullable: false})
    blockNumber!: number

    @StringColumn_({nullable: false})
    transactionHash!: string
}
