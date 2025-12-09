import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {OIFIntent} from "./oifIntent.model"
import {OIFOracleType} from "./_oifOracleType"
import {OIFSettlement} from "./oifSettlement.model"

@Entity_()
export class OIFAttestation {
    constructor(props?: Partial<OIFAttestation>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    attestationId!: string

    @Index_()
    @ManyToOne_(() => OIFIntent, {nullable: true})
    intent!: OIFIntent

    @Index_()
    @StringColumn_({nullable: false})
    orderId!: string

    @Column_("varchar", {length: 15, nullable: false})
    oracleType!: OIFOracleType

    @IntColumn_({nullable: false})
    sourceChainId!: number

    @IntColumn_({nullable: false})
    destinationChainId!: number

    @StringColumn_({nullable: false})
    proof!: string

    @BigIntColumn_({nullable: false})
    proofBlockNumber!: bigint

    @DateTimeColumn_({nullable: false})
    proofTimestamp!: Date

    @BooleanColumn_({nullable: false})
    verified!: boolean

    @DateTimeColumn_({nullable: true})
    verifiedAt!: Date | undefined | null

    @StringColumn_({nullable: true})
    verificationTx!: string | undefined | null

    @Index_()
    @ManyToOne_(() => OIFSettlement, {nullable: true})
    settlement!: OIFSettlement | undefined | null
}
