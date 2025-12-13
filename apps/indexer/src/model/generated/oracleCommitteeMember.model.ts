import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {OracleFeed} from "./oracleFeed.model"
import {OracleOperator} from "./oracleOperator.model"

@Entity_()
export class OracleCommitteeMember {
    constructor(props?: Partial<OracleCommitteeMember>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => OracleFeed, {nullable: true})
    feed!: OracleFeed

    @Index_()
    @ManyToOne_(() => OracleOperator, {nullable: true})
    operator!: OracleOperator

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    addedAt!: Date

    @DateTimeColumn_({nullable: true})
    removedAt!: Date | undefined | null

    @IntColumn_({nullable: false})
    reportsInFeed!: number

    @DateTimeColumn_({nullable: true})
    lastReportAt!: Date | undefined | null
}
