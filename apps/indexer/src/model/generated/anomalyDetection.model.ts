import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {ProtectedContract} from "./protectedContract.model"

@Entity_()
export class AnomalyDetection {
    constructor(props?: Partial<AnomalyDetection>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => ProtectedContract, {nullable: true})
    target!: ProtectedContract

    @StringColumn_({nullable: false})
    anomalyType!: string

    @BigIntColumn_({nullable: false})
    value!: bigint

    @BigIntColumn_({nullable: false})
    threshold!: bigint

    @BooleanColumn_({nullable: false})
    autoPaused!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    detectedAt!: Date

    @IntColumn_({nullable: false})
    blockNumber!: number
}
