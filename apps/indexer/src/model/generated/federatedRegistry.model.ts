import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {FederatedNetwork} from "./federatedNetwork.model"
import {FederationChainType} from "./_federationChainType"
import {FederationRegistryType} from "./_federationRegistryType"
import {FederatedEntry} from "./federatedEntry.model"

@Entity_()
export class FederatedRegistry {
    constructor(props?: Partial<FederatedRegistry>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    registryId!: string

    @Index_()
    @ManyToOne_(() => FederatedNetwork, {nullable: true})
    network!: FederatedNetwork

    @Column_("varchar", {length: 6, nullable: false})
    chainType!: FederationChainType

    @Index_()
    @Column_("varchar", {length: 12, nullable: false})
    registryType!: FederationRegistryType

    @Index_()
    @StringColumn_({nullable: false})
    contractAddress!: string

    @StringColumn_({nullable: false})
    name!: string

    @StringColumn_({nullable: true})
    version!: string | undefined | null

    @StringColumn_({nullable: true})
    metadataUri!: string | undefined | null

    @BigIntColumn_({nullable: false})
    entryCount!: bigint

    @BigIntColumn_({nullable: false})
    lastSyncBlock!: bigint

    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @IntColumn_({nullable: false})
    registeredBlock!: number

    @OneToMany_(() => FederatedEntry, e => e.registry)
    entries!: FederatedEntry[]
}
