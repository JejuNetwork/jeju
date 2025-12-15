import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, BooleanColumn as BooleanColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class AgentEligibility {
    constructor(props?: Partial<AgentEligibility>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @BigIntColumn_({nullable: false})
    agentId!: bigint

    @BooleanColumn_({nullable: false})
    canSubmitProposal!: boolean

    @StringColumn_({nullable: true})
    proposalIneligibleReason!: string | undefined | null

    @BooleanColumn_({nullable: false})
    canVote!: boolean

    @StringColumn_({nullable: true})
    voteIneligibleReason!: string | undefined | null

    @BooleanColumn_({nullable: false})
    canConductResearch!: boolean

    @StringColumn_({nullable: true})
    researchIneligibleReason!: string | undefined | null

    @DateTimeColumn_({nullable: false})
    checkedAt!: Date
}
