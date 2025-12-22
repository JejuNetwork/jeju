import {
  type AbiFunction,
  ContractBase,
  type FunctionArguments,
  type FunctionReturn,
  fun,
} from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

const aggregate = fun(
  '0x252dba42',
  'aggregate((address,bytes)[]',
  {
    calls: p.array(
      p.struct({
        target: p.address,
        callData: p.bytes,
      }),
    ),
  },
  { blockNumber: p.uint256, returnData: p.array(p.bytes) },
)

const tryAggregate = fun(
  '0xbce38bd7',
  'tryAggregate(bool,(address,bytes)[])',
  {
    requireSuccess: p.bool,
    calls: p.array(p.struct({ target: p.address, callData: p.bytes })),
  },
  p.array(p.struct({ success: p.bool, returnData: p.bytes })),
)

/**
 * Polymorphic ABI function type.
 *
 * Note: `any` is required here because:
 * 1. subsquid's AbiFunction<TIn, TOut> expects TIn to satisfy `Struct` constraint
 * 2. The Struct constraint requires `Codec<any, any>` values
 * 3. There's no way to express "any valid ABI function" without these `any` bounds
 *
 * This is a limitation of TypeScript's type system when interfacing with
 * codec-based libraries that use mapped types with strict constraints.
 */
// biome-ignore lint/suspicious/noExplicitAny: subsquid AbiFunction requires any for polymorphic function types
type PolymorphicFunc = AbiFunction<any, any>

export type MulticallResult<T extends PolymorphicFunc> =
  | {
      success: true
      value: FunctionReturn<T>
    }
  | {
      success: false
      returnData?: string
      value?: undefined
    }

type AggregateTuple<T extends PolymorphicFunc = PolymorphicFunc> = [
  func: T,
  address: string,
  args: T extends PolymorphicFunc ? FunctionArguments<T> : never,
]
type Call = { target: string; callData: string }

/**
 * Implementation args type for generic overloaded methods.
 *
 * JUSTIFICATION FOR unknown[]:
 * TypeScript's overload system with generics (e.g., `<TF extends PolymorphicFunc>`)
 * requires the implementation signature to accept any subtype of the constraint.
 * When overloads have different parameter counts and generic types:
 * - Overload 1: (func: TF, address: string, calls: FunctionArguments<TF>[], paging?: number)
 * - Overload 2: (func: TF, calls: [...], paging?: number)
 * - Overload 3: (calls: AggregateTuple[], paging?: number)
 *
 * No concrete union type can satisfy variance requirements because:
 * 1. TF can be any subtype of PolymorphicFunc
 * 2. FunctionArguments<TF> varies with TF
 * 3. Implementation must accept all possible TF instantiations
 *
 * The type safety is enforced by overload signatures at call sites.
 * This implementation uses runtime type checking to dispatch correctly.
 */
type GenericOverloadImplArgs = unknown[]

export class Multicall extends ContractBase {
  static aggregate = aggregate
  static tryAggregate = tryAggregate

  aggregate<TF extends PolymorphicFunc>(
    func: TF,
    address: string,
    calls: FunctionArguments<TF>[],
    paging?: number,
  ): Promise<FunctionReturn<TF>[]>

  aggregate<TF extends PolymorphicFunc>(
    func: TF,
    calls: (readonly [address: string, args: FunctionArguments<TF>])[],
    paging?: number,
  ): Promise<FunctionReturn<TF>[]>

  aggregate(
    calls: AggregateTuple[],
    paging?: number,
  ): Promise<FunctionReturn<PolymorphicFunc>[]>

  /**
   * Implementation signature for overloaded aggregate method.
   * See GenericOverloadImplArgs for justification of unknown[].
   */
  async aggregate(
    ...args: GenericOverloadImplArgs
  ): Promise<FunctionReturn<PolymorphicFunc>[]> {
    const [calls, funcs, page] = this.makeCalls(args)
    const size = calls.length
    const results = new Array(size)
    for (const [from, to] of splitIntoPages(size, page)) {
      const { returnData } = await this.eth_call(aggregate, {
        calls: calls.slice(from, to),
      })
      for (let i = from; i < to; i++) {
        const data = returnData[i - from]
        results[i] = funcs[i].decodeResult(data)
      }
    }
    return results
  }

  tryAggregate<TF extends PolymorphicFunc>(
    func: TF,
    address: string,
    calls: FunctionArguments<TF>[],
    paging?: number,
  ): Promise<MulticallResult<TF>[]>

  tryAggregate<TF extends PolymorphicFunc>(
    func: TF,
    calls: (readonly [address: string, args: FunctionArguments<TF>])[],
    paging?: number,
  ): Promise<MulticallResult<TF>[]>

  tryAggregate(
    calls: AggregateTuple[],
    paging?: number,
  ): Promise<MulticallResult<PolymorphicFunc>[]>

  /**
   * Implementation signature for overloaded tryAggregate method.
   * See GenericOverloadImplArgs for justification of unknown[].
   */
  async tryAggregate(
    ...args: GenericOverloadImplArgs
  ): Promise<MulticallResult<PolymorphicFunc>[]> {
    const [calls, funcs, page] = this.makeCalls(args)
    const size = calls.length
    const results: MulticallResult<PolymorphicFunc>[] = new Array(size)
    for (const [from, to] of splitIntoPages(size, page)) {
      const response = await this.eth_call(tryAggregate, {
        requireSuccess: false,
        calls: calls.slice(from, to),
      })
      for (let i = from; i < to; i++) {
        const res = response[i - from]
        if (res.success) {
          try {
            results[i] = {
              success: true,
              value: funcs[i].decodeResult(res.returnData),
            }
          } catch {
            results[i] = { success: false, returnData: res.returnData }
          }
        } else {
          results[i] = { success: false }
        }
      }
    }
    return results
  }

  /**
   * Parse variadic arguments into structured call data.
   * Uses type assertions because args come from overloaded methods
   * with different signatures - TypeScript can't narrow the union.
   */
  private makeCalls(
    args: GenericOverloadImplArgs,
  ): [calls: Call[], funcs: PolymorphicFunc[], page: number] {
    const page =
      typeof args[args.length - 1] === 'number'
        ? (args.pop() as number)
        : Number.MAX_SAFE_INTEGER
    switch (args.length) {
      case 1: {
        const list = args[0] as AggregateTuple[]
        const calls: Call[] = new Array(list.length)
        const funcs: PolymorphicFunc[] = new Array(list.length)
        for (let i = 0; i < list.length; i++) {
          const [func, address, fnArgs] = list[i]
          calls[i] = { target: address, callData: func.encode(fnArgs) }
          funcs[i] = func
        }
        return [calls, funcs, page]
      }
      case 2: {
        const func = args[0] as PolymorphicFunc
        const list = args[1] as [
          address: string,
          fnArgs: FunctionArguments<PolymorphicFunc>,
        ][]
        const calls: Call[] = new Array(list.length)
        const funcs: PolymorphicFunc[] = new Array(list.length)
        for (let i = 0; i < list.length; i++) {
          const [address, fnArgs] = list[i]
          calls[i] = { target: address, callData: func.encode(fnArgs) }
          funcs[i] = func
        }
        return [calls, funcs, page]
      }
      case 3: {
        const func = args[0] as PolymorphicFunc
        const address = args[1] as string
        const list = args[2] as FunctionArguments<PolymorphicFunc>[]
        const calls: Call[] = new Array(list.length)
        const funcs: PolymorphicFunc[] = new Array(list.length)
        for (let i = 0; i < list.length; i++) {
          const fnArgs = list[i]
          calls[i] = { target: address, callData: func.encode(fnArgs) }
          funcs[i] = func
        }
        return [calls, funcs, page]
      }
      default:
        throw new Error('unexpected number of arguments')
    }
  }
}

function* splitIntoPages(
  size: number,
  page: number,
): Iterable<[from: number, to: number]> {
  let from = 0
  while (size) {
    const step = Math.min(page, size)
    const to = from + step
    yield [from, to]
    size -= step
    from = to
  }
}
