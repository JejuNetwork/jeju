import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { DEXPool } from './dexPool.model'

/**
 * DEX protocol registry.
 */
@Entity_()
export class DEX {
  constructor(props?: Partial<DEX>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @StringColumn_({ nullable: false })
  name!: string

  @Index_()
  @IntColumn_({ nullable: false })
  chainId!: number

  @StringColumn_({ nullable: false })
  factory!: string

  @StringColumn_({ nullable: true })
  router!: string | undefined | null

  @StringColumn_({ nullable: false })
  version!: string

  @IntColumn_({ nullable: false })
  poolCount!: number

  @StringColumn_({ nullable: false })
  totalVolumeUSD!: string

  @StringColumn_({ nullable: false })
  totalLiquidityUSD!: string

  @IntColumn_({ nullable: false })
  totalTxCount!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date

  @OneToMany_(
    () => DEXPool,
    (e) => e.dex,
  )
  pools!: DEXPool[]
}
