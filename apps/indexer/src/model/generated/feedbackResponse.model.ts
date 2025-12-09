import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {AgentFeedback} from "./agentFeedback.model"
import {Account} from "./account.model"

@Entity_()
export class FeedbackResponse {
    constructor(props?: Partial<FeedbackResponse>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => AgentFeedback, {nullable: true})
    feedback!: AgentFeedback

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    responder!: Account

    @StringColumn_({nullable: false})
    responseUri!: string

    @StringColumn_({nullable: true})
    responseHash!: string | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
