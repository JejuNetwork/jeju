import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_} from "@subsquid/typeorm-store"
import {FederatedNetwork} from "./federatedNetwork.model"

@Entity_()
export class FederatedNetworkContracts {
    constructor(props?: Partial<FederatedNetworkContracts>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => FederatedNetwork, {nullable: true})
    network!: FederatedNetwork

    @StringColumn_({nullable: true})
    identityRegistry!: string | undefined | null

    @StringColumn_({nullable: true})
    solverRegistry!: string | undefined | null

    @StringColumn_({nullable: true})
    inputSettler!: string | undefined | null

    @StringColumn_({nullable: true})
    outputSettler!: string | undefined | null

    @StringColumn_({nullable: true})
    liquidityVault!: string | undefined | null

    @StringColumn_({nullable: true})
    governance!: string | undefined | null

    @StringColumn_({nullable: true})
    oracle!: string | undefined | null

    @StringColumn_({nullable: true})
    registryHub!: string | undefined | null
}
