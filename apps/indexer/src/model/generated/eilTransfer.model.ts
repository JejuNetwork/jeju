import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, IntColumn as IntColumn_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {XLP} from "./xlp.model"
import {CrossChainVoucherRequest} from "./crossChainVoucherRequest.model"
import {CrossChainVoucher} from "./crossChainVoucher.model"
import {TransferStatus} from "./_transferStatus"

@Entity_()
export class EILTransfer {
    constructor(props?: Partial<EILTransfer>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    user!: Account

    @Index_()
    @IntColumn_({nullable: false})
    sourceChain!: number

    @Index_()
    @IntColumn_({nullable: false})
    destinationChain!: number

    @StringColumn_({nullable: false})
    sourceToken!: string

    @StringColumn_({nullable: false})
    destinationToken!: string

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @BigIntColumn_({nullable: false})
    fee!: bigint

    @Index_()
    @ManyToOne_(() => XLP, {nullable: true})
    xlp!: XLP | undefined | null

    @Index_()
    @ManyToOne_(() => CrossChainVoucherRequest, {nullable: true})
    request!: CrossChainVoucherRequest | undefined | null

    @Index_()
    @ManyToOne_(() => CrossChainVoucher, {nullable: true})
    voucher!: CrossChainVoucher | undefined | null

    @Index_()
    @Column_("varchar", {length: 11, nullable: false})
    status!: TransferStatus

    @Index_()
    @DateTimeColumn_({nullable: false})
    initiatedAt!: Date

    @DateTimeColumn_({nullable: true})
    completedAt!: Date | undefined | null

    @StringColumn_({nullable: false})
    sourceTxHash!: string

    @StringColumn_({nullable: true})
    destinationTxHash!: string | undefined | null
}
