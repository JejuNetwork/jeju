import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, IntColumn as IntColumn_, StringColumn as StringColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {RegisteredAgent} from "./registeredAgent.model"
import {Account} from "./account.model"
import {FeedbackResponse} from "./feedbackResponse.model"

@Entity_()
export class AgentFeedback {
    constructor(props?: Partial<AgentFeedback>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => RegisteredAgent, {nullable: true})
    agent!: RegisteredAgent

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    client!: Account

    @IntColumn_({nullable: false})
    score!: number

    @StringColumn_({nullable: true})
    tag1!: string | undefined | null

    @StringColumn_({nullable: true})
    tag2!: string | undefined | null

    @StringColumn_({nullable: true})
    fileUri!: string | undefined | null

    @StringColumn_({nullable: true})
    fileHash!: string | undefined | null

    @BooleanColumn_({nullable: false})
    isRevoked!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number

    @OneToMany_(() => FeedbackResponse, e => e.feedback)
    responses!: FeedbackResponse[]
}
