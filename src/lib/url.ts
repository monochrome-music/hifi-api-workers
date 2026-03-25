export type QueryValue = string | number | boolean | null | undefined
export type QueryInput = Record<string, QueryValue> | Array<[string, QueryValue]>

export function buildUrl(input: string, params?: QueryInput): string {
  const url = new URL(input)

  if (!params) {
    return url.toString()
  }

  const entries = Array.isArray(params) ? params : Object.entries(params)
  for (const [key, value] of entries) {
    if (value == null) {
      continue
    }

    url.searchParams.append(key, String(value))
  }

  return url.toString()
}
