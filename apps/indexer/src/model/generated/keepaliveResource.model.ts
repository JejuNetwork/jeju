import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Keepalive} from "./keepalive.model"
import {KeepaliveResourceType} from "./_keepaliveResourceType"

@Entity_()
export class KeepaliveResource {
    constructor(props?: Partial<KeepaliveResource>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Keepalive, {nullable: true})
    keepalive!: Keepalive

    @Column_("varchar", {length: 16, nullable: false})
    resourceType!: KeepaliveResourceType

    @StringColumn_({nullable: false})
    identifier!: string

    @StringColumn_({nullable: true})
    healthEndpoint!: string | undefined | null

    @BigIntColumn_({nullable: false})
    minBalance!: bigint

    @BooleanColumn_({nullable: false})
    required!: boolean

    @DateTimeColumn_({nullable: false})
    addedAt!: Date
}
