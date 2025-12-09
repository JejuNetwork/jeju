import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, ManyToOne as ManyToOne_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {OIFSolver} from "./oifSolver.model"

@Entity_()
export class OIFQuote {
    constructor(props?: Partial<OIFQuote>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    quoteId!: string

    @Index_()
    @IntColumn_({nullable: false})
    sourceChainId!: number

    @Index_()
    @IntColumn_({nullable: false})
    destinationChainId!: number

    @StringColumn_({nullable: false})
    sourceToken!: string

    @StringColumn_({nullable: false})
    destinationToken!: string

    @BigIntColumn_({nullable: false})
    inputAmount!: bigint

    @BigIntColumn_({nullable: false})
    outputAmount!: bigint

    @BigIntColumn_({nullable: false})
    fee!: bigint

    @IntColumn_({nullable: false})
    feePercent!: number

    @IntColumn_({nullable: false})
    priceImpact!: number

    @IntColumn_({nullable: false})
    estimatedFillTimeSeconds!: number

    @DateTimeColumn_({nullable: false})
    validUntil!: Date

    @Index_()
    @ManyToOne_(() => OIFSolver, {nullable: true})
    solver!: OIFSolver

    @IntColumn_({nullable: false})
    solverReputation!: number

    @BooleanColumn_({nullable: false})
    accepted!: boolean

    @BooleanColumn_({nullable: false})
    expired!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date
}
