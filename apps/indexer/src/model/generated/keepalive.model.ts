import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {KeepaliveStatus} from "./_keepaliveStatus"
import {KeepaliveResource} from "./keepaliveResource.model"
import {KeepaliveHealthCheck} from "./keepaliveHealthCheck.model"

@Entity_()
export class Keepalive {
    constructor(props?: Partial<Keepalive>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    owner!: Account

    @Index_()
    @StringColumn_({nullable: false})
    jnsNode!: string

    @BigIntColumn_({nullable: true})
    agentId!: bigint | undefined | null

    @Index_()
    @StringColumn_({nullable: false})
    vaultAddress!: string

    @BigIntColumn_({nullable: false})
    globalMinBalance!: bigint

    @IntColumn_({nullable: false})
    checkInterval!: number

    @BigIntColumn_({nullable: false})
    autoFundAmount!: bigint

    @BooleanColumn_({nullable: false})
    autoFundEnabled!: boolean

    @BooleanColumn_({nullable: false})
    active!: boolean

    @Column_("varchar", {length: 9, nullable: false})
    status!: KeepaliveStatus

    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    lastCheckAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    lastHealthy!: Date | undefined | null

    @BigIntColumn_({nullable: false})
    totalAutoFunded!: bigint

    @IntColumn_({nullable: false})
    healthCheckCount!: number

    @OneToMany_(() => KeepaliveResource, e => e.keepalive)
    resources!: KeepaliveResource[]

    @OneToMany_(() => KeepaliveHealthCheck, e => e.keepalive)
    healthChecks!: KeepaliveHealthCheck[]
}
