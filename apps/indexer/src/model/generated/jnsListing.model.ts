import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {JNSName} from "./jnsName.model"
import {Account} from "./account.model"
import {JNSListingStatus} from "./_jnsListingStatus"

@Entity_()
export class JNSListing {
    constructor(props?: Partial<JNSListing>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => JNSName, {nullable: true})
    name!: JNSName

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    seller!: Account

    @BigIntColumn_({nullable: false})
    price!: bigint

    @StringColumn_({nullable: false})
    currency!: string

    @Column_("varchar", {length: 9, nullable: false})
    status!: JNSListingStatus

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    expiresAt!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    soldAt!: Date | undefined | null

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    buyer!: Account | undefined | null

    @StringColumn_({nullable: false})
    txHash!: string

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number
}
