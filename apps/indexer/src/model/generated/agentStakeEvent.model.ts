import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {RegisteredAgent} from "./registeredAgent.model"

@Entity_()
export class AgentStakeEvent {
    constructor(props?: Partial<AgentStakeEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => RegisteredAgent, {nullable: true})
    agent!: RegisteredAgent

    @StringColumn_({nullable: false})
    eventType!: string

    @IntColumn_({nullable: true})
    oldTier!: number | undefined | null

    @IntColumn_({nullable: true})
    newTier!: number | undefined | null

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @StringColumn_({nullable: false})
    token!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
