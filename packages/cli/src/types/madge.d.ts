declare module 'madge' {
  interface MadgeConfig {
    fileExtensions?: string[]
    tsConfig?: string
    detectiveOptions?: {
      ts?: { skipTypeImports?: boolean }
    }
  }

  interface MadgeResult {
    circular(): string[][]
    obj(): Record<string, string[]>
    depends(id: string): string[]
    orphans(): string[]
    leaves(): string[]
  }

  function madge(path: string, config?: MadgeConfig): Promise<MadgeResult>

  export default madge
}
