import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BytesColumn as BytesColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, StringColumn as StringColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {CouncilVote} from "./councilVote.model"
import {ProposalBacker} from "./proposalBacker.model"
import {VetoVote} from "./vetoVote.model"

@Entity_()
export class CouncilProposal {
    constructor(props?: Partial<CouncilProposal>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @BytesColumn_({nullable: false})
    proposalId!: Uint8Array

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    proposer!: Account

    @BigIntColumn_({nullable: true})
    proposerAgentId!: bigint | undefined | null

    @IntColumn_({nullable: false})
    proposalType!: number

    @Index_()
    @StringColumn_({nullable: false})
    status!: string

    @IntColumn_({nullable: false})
    qualityScore!: number

    @BytesColumn_({nullable: false})
    contentHash!: Uint8Array

    @StringColumn_({nullable: true})
    targetContract!: string | undefined | null

    @BytesColumn_({nullable: true})
    callData!: Uint8Array | undefined | null

    @BigIntColumn_({nullable: false})
    value!: bigint

    @BigIntColumn_({nullable: false})
    totalStaked!: bigint

    @BigIntColumn_({nullable: false})
    totalReputation!: bigint

    @IntColumn_({nullable: false})
    backerCount!: number

    @BooleanColumn_({nullable: false})
    hasResearch!: boolean

    @BytesColumn_({nullable: true})
    researchHash!: Uint8Array | undefined | null

    @BooleanColumn_({nullable: false})
    ceoApproved!: boolean

    @BytesColumn_({nullable: true})
    ceoDecisionHash!: Uint8Array | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    councilVoteEnd!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    gracePeriodEnd!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    executedAt!: Date | undefined | null

    @OneToMany_(() => CouncilVote, e => e.proposal)
    councilVotes!: CouncilVote[]

    @OneToMany_(() => ProposalBacker, e => e.proposal)
    backers!: ProposalBacker[]

    @OneToMany_(() => VetoVote, e => e.proposal)
    vetoVotes!: VetoVote[]
}
