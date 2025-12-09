import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {RegisteredAgent} from "./registeredAgent.model"

@Entity_()
export class AgentSlashEvent {
    constructor(props?: Partial<AgentSlashEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => RegisteredAgent, {nullable: true})
    agent!: RegisteredAgent

    @BigIntColumn_({nullable: false})
    slashAmount!: bigint

    @StringColumn_({nullable: false})
    reason!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
