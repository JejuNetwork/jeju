import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, BytesColumn as BytesColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {CouncilProposal} from "./councilProposal.model"
import {Account} from "./account.model"

@Entity_()
export class VetoVote {
    constructor(props?: Partial<VetoVote>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => CouncilProposal, {nullable: true})
    proposal!: CouncilProposal

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    voter!: Account

    @BigIntColumn_({nullable: true})
    agentId!: bigint | undefined | null

    @StringColumn_({nullable: false})
    category!: string

    @BytesColumn_({nullable: false})
    reasonHash!: Uint8Array

    @BigIntColumn_({nullable: false})
    stakedAmount!: bigint

    @BigIntColumn_({nullable: false})
    reputationWeight!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    votedAt!: Date
}
