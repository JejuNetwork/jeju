import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Keepalive} from "./keepalive.model"
import {KeepaliveStatus} from "./_keepaliveStatus"

@Entity_()
export class KeepaliveHealthCheck {
    constructor(props?: Partial<KeepaliveHealthCheck>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Keepalive, {nullable: true})
    keepalive!: Keepalive

    @Column_("varchar", {length: 9, nullable: false})
    status!: KeepaliveStatus

    @BigIntColumn_({nullable: false})
    balance!: bigint

    @IntColumn_({nullable: false})
    healthyResources!: number

    @IntColumn_({nullable: false})
    totalResources!: number

    @StringColumn_({array: true, nullable: false})
    failedResources!: (string)[]

    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number

    @Index_()
    @StringColumn_({nullable: false})
    txHash!: string
}
