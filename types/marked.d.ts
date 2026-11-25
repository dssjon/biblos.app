declare module "marked" {
  export const marked: {
    parse(src: string, options?: Record<string, unknown>): string
  }
}
