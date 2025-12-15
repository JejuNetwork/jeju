import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class VotingPowerSnapshot {
    constructor(props?: Partial<VotingPowerSnapshot>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    voter!: string

    @BigIntColumn_({nullable: true})
    agentId!: bigint | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    proposalId!: string | undefined | null

    @BigIntColumn_({nullable: false})
    baseVotes!: bigint

    @IntColumn_({nullable: false})
    reputationMultiplier!: number

    @IntColumn_({nullable: false})
    stakeMultiplier!: number

    @BigIntColumn_({nullable: false})
    effectiveVotes!: bigint

    @DateTimeColumn_({nullable: false})
    snapshotAt!: Date

    @IntColumn_({nullable: false})
    blockNumber!: number
}
