import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, ManyToOne as ManyToOne_, StringColumn as StringColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {AgentMetadata} from "./agentMetadata.model"
import {RegistryStake} from "./registryStake.model"
import {TagUpdate} from "./tagUpdate.model"
import {AgentBanEvent} from "./agentBanEvent.model"
import {AgentSlashEvent} from "./agentSlashEvent.model"
import {AgentStakeEvent} from "./agentStakeEvent.model"
import {AgentFeedback} from "./agentFeedback.model"
import {AgentValidation} from "./agentValidation.model"

@Entity_()
export class RegisteredAgent {
    constructor(props?: Partial<RegisteredAgent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @BigIntColumn_({nullable: false})
    agentId!: bigint

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    owner!: Account

    @StringColumn_({nullable: true})
    tokenURI!: string | undefined | null

    @StringColumn_({nullable: false})
    name!: string

    @StringColumn_({nullable: true})
    description!: string | undefined | null

    @StringColumn_({array: true, nullable: false})
    tags!: (string)[]

    @IntColumn_({nullable: false})
    stakeTier!: number

    @StringColumn_({nullable: false})
    stakeToken!: string

    @BigIntColumn_({nullable: false})
    stakeAmount!: bigint

    @BooleanColumn_({nullable: false})
    stakeWithdrawn!: boolean

    @BooleanColumn_({nullable: false})
    isSlashed!: boolean

    @BooleanColumn_({nullable: false})
    isBanned!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @BigIntColumn_({nullable: false})
    depositedAt!: bigint

    @BigIntColumn_({nullable: true})
    withdrawnAt!: bigint | undefined | null

    @DateTimeColumn_({nullable: true})
    lastActivityAt!: Date | undefined | null

    @BooleanColumn_({nullable: false})
    active!: boolean

    @StringColumn_({nullable: true})
    a2aEndpoint!: string | undefined | null

    @StringColumn_({nullable: true})
    mcpEndpoint!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    serviceType!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    category!: string | undefined | null

    @BooleanColumn_({nullable: false})
    x402Support!: boolean

    @StringColumn_({array: true, nullable: false})
    mcpTools!: (string)[]

    @StringColumn_({array: true, nullable: false})
    a2aSkills!: (string)[]

    @StringColumn_({nullable: true})
    image!: string | undefined | null

    @OneToMany_(() => AgentMetadata, e => e.agent)
    metadataUpdates!: AgentMetadata[]

    @OneToMany_(() => RegistryStake, e => e.agent)
    stakes!: RegistryStake[]

    @OneToMany_(() => TagUpdate, e => e.agent)
    tagUpdates!: TagUpdate[]

    @OneToMany_(() => AgentBanEvent, e => e.agent)
    banEvents!: AgentBanEvent[]

    @OneToMany_(() => AgentSlashEvent, e => e.agent)
    slashEvents!: AgentSlashEvent[]

    @OneToMany_(() => AgentStakeEvent, e => e.agent)
    stakeEvents!: AgentStakeEvent[]

    @OneToMany_(() => AgentFeedback, e => e.agent)
    feedback!: AgentFeedback[]

    @OneToMany_(() => AgentValidation, e => e.agent)
    validations!: AgentValidation[]
}
