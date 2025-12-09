import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {ComputeResource} from "./computeResource.model"
import {ComputeRental} from "./computeRental.model"
import {InferenceRequest} from "./inferenceRequest.model"

@Entity_()
export class ComputeProvider {
    constructor(props?: Partial<ComputeProvider>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @StringColumn_({nullable: true})
    name!: string | undefined | null

    @StringColumn_({nullable: false})
    endpoint!: string

    @StringColumn_({nullable: true})
    attestationHash!: string | undefined | null

    @BigIntColumn_({nullable: false})
    stakeAmount!: bigint

    @IntColumn_({nullable: true})
    agentId!: number | undefined | null

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date

    @IntColumn_({nullable: false})
    totalRentals!: number

    @BigIntColumn_({nullable: false})
    totalEarnings!: bigint

    @OneToMany_(() => ComputeResource, e => e.provider)
    resources!: ComputeResource[]

    @OneToMany_(() => ComputeRental, e => e.provider)
    rentals!: ComputeRental[]

    @OneToMany_(() => InferenceRequest, e => e.provider)
    inferenceRequests!: InferenceRequest[]
}
