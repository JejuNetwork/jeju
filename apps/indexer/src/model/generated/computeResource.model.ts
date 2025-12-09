import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {ComputeProvider} from "./computeProvider.model"
import {ComputeRental} from "./computeRental.model"

@Entity_()
export class ComputeResource {
    constructor(props?: Partial<ComputeResource>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => ComputeProvider, {nullable: true})
    provider!: ComputeProvider

    @Index_()
    @StringColumn_({nullable: false})
    resourceId!: string

    @IntColumn_({nullable: false})
    gpuCount!: number

    @IntColumn_({nullable: false})
    cpuCores!: number

    @IntColumn_({nullable: false})
    memoryGB!: number

    @BigIntColumn_({nullable: false})
    pricePerHour!: bigint

    @Index_()
    @BooleanColumn_({nullable: false})
    isAvailable!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @OneToMany_(() => ComputeRental, e => e.resource)
    rentals!: ComputeRental[]
}
