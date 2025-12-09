import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BooleanColumn as BooleanColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {RegisteredAgent} from "./registeredAgent.model"

@Entity_()
export class AgentBanEvent {
    constructor(props?: Partial<AgentBanEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => RegisteredAgent, {nullable: true})
    agent!: RegisteredAgent

    @BooleanColumn_({nullable: false})
    isBan!: boolean

    @StringColumn_({nullable: false})
    banType!: string

    @StringColumn_({nullable: true})
    appId!: string | undefined | null

    @StringColumn_({nullable: true})
    reason!: string | undefined | null

    @StringColumn_({nullable: true})
    proposalId!: string | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
