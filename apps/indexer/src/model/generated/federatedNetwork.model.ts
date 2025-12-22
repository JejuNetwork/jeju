import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, StringColumn as StringColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, ManyToOne as ManyToOne_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {FederationTrustTier} from "./_federationTrustTier"
import {FederatedNetworkContracts} from "./federatedNetworkContracts.model"
import {FederatedRegistry} from "./federatedRegistry.model"

@Entity_()
export class FederatedNetwork {
    constructor(props?: Partial<FederatedNetwork>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @BigIntColumn_({nullable: false})
    chainId!: bigint

    @Index_()
    @StringColumn_({nullable: false})
    name!: string

    @StringColumn_({nullable: false})
    rpcUrl!: string

    @StringColumn_({nullable: true})
    explorerUrl!: string | undefined | null

    @StringColumn_({nullable: true})
    wsUrl!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: false})
    operator!: string

    @StringColumn_({nullable: true})
    genesisHash!: string | undefined | null

    @BigIntColumn_({nullable: false})
    stake!: bigint

    @Column_("varchar", {length: 8, nullable: false})
    trustTier!: FederationTrustTier

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @BooleanColumn_({nullable: false})
    isVerified!: boolean

    @BooleanColumn_({nullable: false})
    isSuperchain!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @IntColumn_({nullable: false})
    registeredBlock!: number

    @StringColumn_({nullable: false})
    registeredTx!: string

    @Index_()
    @ManyToOne_(() => FederatedNetworkContracts, {nullable: true})
    contracts!: FederatedNetworkContracts | undefined | null

    @OneToMany_(() => FederatedRegistry, e => e.network)
    registries!: FederatedRegistry[]
}
