import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {OIFIntent} from "./oifIntent.model"
import {OIFSolver} from "./oifSolver.model"
import {OIFSettlementStatus} from "./_oifSettlementStatus"
import {OIFAttestation} from "./oifAttestation.model"

@Entity_()
export class OIFSettlement {
    constructor(props?: Partial<OIFSettlement>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    settlementId!: string

    @Index_()
    @ManyToOne_(() => OIFIntent, {nullable: true})
    intent!: OIFIntent

    @Index_()
    @ManyToOne_(() => OIFSolver, {nullable: true})
    solver!: OIFSolver

    @IntColumn_({nullable: false})
    sourceChainId!: number

    @IntColumn_({nullable: false})
    destinationChainId!: number

    @StringColumn_({nullable: false})
    inputToken!: string

    @StringColumn_({nullable: false})
    outputToken!: string

    @BigIntColumn_({nullable: false})
    inputAmount!: bigint

    @BigIntColumn_({nullable: false})
    outputAmount!: bigint

    @BigIntColumn_({nullable: false})
    fee!: bigint

    @Index_()
    @Column_("varchar", {length: 8, nullable: false})
    status!: OIFSettlementStatus

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    attestedAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    settledAt!: Date | undefined | null

    @StringColumn_({nullable: false})
    inputSettlerTx!: string

    @StringColumn_({nullable: false})
    outputSettlerTx!: string

    @StringColumn_({nullable: true})
    attestationTx!: string | undefined | null

    @StringColumn_({nullable: true})
    claimTx!: string | undefined | null

    @Index_()
    @ManyToOne_(() => OIFAttestation, {nullable: true})
    attestation!: OIFAttestation | undefined | null
}
