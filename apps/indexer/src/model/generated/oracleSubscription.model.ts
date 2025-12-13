import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, ManyToOne as ManyToOne_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"

@Entity_()
export class OracleSubscription {
    constructor(props?: Partial<OracleSubscription>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @BigIntColumn_({nullable: false})
    subscriptionId!: bigint

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    subscriber!: Account

    @StringColumn_({array: true, nullable: false})
    feedIds!: (string)[]

    @Index_()
    @DateTimeColumn_({nullable: false})
    startTime!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    endTime!: Date

    @IntColumn_({nullable: false})
    monthsPaid!: number

    @BigIntColumn_({nullable: false})
    totalPaid!: bigint

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @DateTimeColumn_({nullable: true})
    cancelledAt!: Date | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @StringColumn_({nullable: false})
    txHash!: string
}
