import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {OIFIntentStatus} from "./_oifIntentStatus"
import {OIFSolver} from "./oifSolver.model"
import {OIFSettlement} from "./oifSettlement.model"
import {OIFQuote} from "./oifQuote.model"

@Entity_()
export class OIFIntent {
    constructor(props?: Partial<OIFIntent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    intentId!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    user!: Account

    @BigIntColumn_({nullable: false})
    nonce!: bigint

    @Index_()
    @IntColumn_({nullable: false})
    sourceChainId!: number

    @BigIntColumn_({nullable: false})
    openDeadline!: bigint

    @BigIntColumn_({nullable: false})
    fillDeadline!: bigint

    @Index_()
    @StringColumn_({nullable: false})
    inputToken!: string

    @BigIntColumn_({nullable: false})
    inputAmount!: bigint

    @StringColumn_({nullable: false})
    outputToken!: string

    @BigIntColumn_({nullable: false})
    outputAmount!: bigint

    @Index_()
    @IntColumn_({nullable: false})
    outputChainId!: number

    @Index_()
    @StringColumn_({nullable: false})
    recipient!: string

    @BigIntColumn_({nullable: false})
    maxFee!: bigint

    @BigIntColumn_({nullable: true})
    actualFee!: bigint | undefined | null

    @Index_()
    @Column_("varchar", {length: 18, nullable: false})
    status!: OIFIntentStatus

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    claimedAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    filledAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    settledAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    expiredAt!: Date | undefined | null

    @Index_()
    @ManyToOne_(() => OIFSolver, {nullable: true})
    solver!: OIFSolver | undefined | null

    @Index_()
    @ManyToOne_(() => OIFSettlement, {nullable: true})
    settlement!: OIFSettlement | undefined | null

    @StringColumn_({nullable: false})
    inputSettlerTx!: string

    @StringColumn_({nullable: true})
    outputSettlerTx!: string | undefined | null

    @StringColumn_({nullable: true})
    attestationTx!: string | undefined | null

    @StringColumn_({nullable: true})
    claimTx!: string | undefined | null

    @BigIntColumn_({nullable: false})
    createdBlock!: bigint

    @BigIntColumn_({nullable: true})
    filledBlock!: bigint | undefined | null

    @Index_()
    @ManyToOne_(() => OIFQuote, {nullable: true})
    acceptedQuote!: OIFQuote | undefined | null
}
