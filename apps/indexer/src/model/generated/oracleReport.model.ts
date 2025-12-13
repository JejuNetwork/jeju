import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {OracleFeed} from "./oracleFeed.model"
import {Account} from "./account.model"
import {OracleDispute} from "./oracleDispute.model"

@Entity_()
export class OracleReport {
    constructor(props?: Partial<OracleReport>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    reportId!: string

    @Index_()
    @ManyToOne_(() => OracleFeed, {nullable: true})
    feed!: OracleFeed

    @Index_()
    @BigIntColumn_({nullable: false})
    round!: bigint

    @BigIntColumn_({nullable: false})
    price!: bigint

    @BigIntColumn_({nullable: false})
    confidence!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({array: true, nullable: false})
    signers!: (string)[]

    @IntColumn_({nullable: false})
    signatureCount!: number

    @Index_()
    @BooleanColumn_({nullable: false})
    isDisputed!: boolean

    @BooleanColumn_({nullable: false})
    isValid!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    submittedAt!: Date

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    submittedBy!: Account

    @StringColumn_({nullable: false})
    txHash!: string

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number

    @Index_()
    @ManyToOne_(() => OracleDispute, {nullable: true})
    dispute!: OracleDispute | undefined | null
}
