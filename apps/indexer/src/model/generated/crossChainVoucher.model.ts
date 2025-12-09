import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {CrossChainVoucherRequest} from "./crossChainVoucherRequest.model"
import {XLP} from "./xlp.model"
import {VoucherStatus} from "./_voucherStatus"

@Entity_()
export class CrossChainVoucher {
    constructor(props?: Partial<CrossChainVoucher>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    voucherId!: string

    @Index_()
    @ManyToOne_(() => CrossChainVoucherRequest, {nullable: true})
    request!: CrossChainVoucherRequest

    @Index_()
    @ManyToOne_(() => XLP, {nullable: true})
    xlp!: XLP

    @IntColumn_({nullable: false})
    sourceChainId!: number

    @IntColumn_({nullable: false})
    destinationChainId!: number

    @StringColumn_({nullable: false})
    sourceToken!: string

    @StringColumn_({nullable: false})
    destinationToken!: string

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @BigIntColumn_({nullable: false})
    fee!: bigint

    @BigIntColumn_({nullable: false})
    gasProvided!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    issuedAt!: Date

    @BigIntColumn_({nullable: false})
    issuedBlock!: bigint

    @BigIntColumn_({nullable: false})
    expiresBlock!: bigint

    @Index_()
    @Column_("varchar", {length: 9, nullable: false})
    status!: VoucherStatus

    @BooleanColumn_({nullable: false})
    fulfilled!: boolean

    @BooleanColumn_({nullable: false})
    slashed!: boolean

    @StringColumn_({nullable: true})
    sourceClaimTx!: string | undefined | null

    @StringColumn_({nullable: true})
    destinationFulfillTx!: string | undefined | null

    @DateTimeColumn_({nullable: true})
    fulfillmentTime!: Date | undefined | null
}
