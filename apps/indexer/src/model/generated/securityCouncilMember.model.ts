import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"

@Entity_()
export class SecurityCouncilMember {
    constructor(props?: Partial<SecurityCouncilMember>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    member!: Account

    @BigIntColumn_({nullable: true})
    agentId!: bigint | undefined | null

    @BigIntColumn_({nullable: false})
    combinedScore!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    electedAt!: Date

    @DateTimeColumn_({nullable: true})
    removedAt!: Date | undefined | null

    @Index_()
    @BooleanColumn_({nullable: false})
    active!: boolean
}
