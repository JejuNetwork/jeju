import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {RegisteredAgent} from "./registeredAgent.model"
import {Account} from "./account.model"

@Entity_()
export class AgentValidation {
    constructor(props?: Partial<AgentValidation>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => RegisteredAgent, {nullable: true})
    agent!: RegisteredAgent

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    validator!: Account

    @StringColumn_({nullable: false})
    requestUri!: string

    @StringColumn_({nullable: false})
    requestHash!: string

    @IntColumn_({nullable: true})
    response!: number | undefined | null

    @StringColumn_({nullable: true})
    responseUri!: string | undefined | null

    @StringColumn_({nullable: true})
    responseHash!: string | undefined | null

    @StringColumn_({nullable: true})
    tag!: string | undefined | null

    @StringColumn_({nullable: false})
    status!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    requestedAt!: Date

    @DateTimeColumn_({nullable: true})
    respondedAt!: Date | undefined | null

    @StringColumn_({nullable: false})
    requestTxHash!: string

    @StringColumn_({nullable: true})
    responseTxHash!: string | undefined | null

    @IntColumn_({nullable: false})
    blockNumber!: number
}
