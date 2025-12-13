import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class PerpInsuranceFund {
    constructor(props?: Partial<PerpInsuranceFund>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    token!: string

    @BigIntColumn_({nullable: false})
    balance!: bigint

    @BigIntColumn_({nullable: false})
    totalDeposited!: bigint

    @BigIntColumn_({nullable: false})
    totalWithdrawn!: bigint

    @BigIntColumn_({nullable: false})
    totalBadDebtCovered!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
