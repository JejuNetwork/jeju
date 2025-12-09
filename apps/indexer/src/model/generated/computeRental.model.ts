import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {ComputeProvider} from "./computeProvider.model"
import {ComputeResource} from "./computeResource.model"
import {ComputeRentalStatus} from "./_computeRentalStatus"

@Entity_()
export class ComputeRental {
    constructor(props?: Partial<ComputeRental>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    rentalId!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    renter!: Account

    @Index_()
    @ManyToOne_(() => ComputeProvider, {nullable: true})
    provider!: ComputeProvider

    @Index_()
    @ManyToOne_(() => ComputeResource, {nullable: true})
    resource!: ComputeResource | undefined | null

    @BigIntColumn_({nullable: false})
    duration!: bigint

    @BigIntColumn_({nullable: false})
    price!: bigint

    @Index_()
    @Column_("varchar", {length: 9, nullable: false})
    status!: ComputeRentalStatus

    @DateTimeColumn_({nullable: true})
    startTime!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    endTime!: Date | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
