import { ApiError } from './errors'

interface IntOptions {
  defaultValue?: number
  min?: number
  max?: number
  required?: boolean
}

export function getString(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)
  return value == null ? undefined : value
}

export function getRequiredString(searchParams: URLSearchParams, key: string): string {
  const value = getString(searchParams, key)
  if (value == null || value.length === 0) {
    throw new ApiError(400, `Missing or invalid query param: ${key}`)
  }

  return value
}

export function getInt(searchParams: URLSearchParams, key: string, options: IntOptions = {}): number {
  const raw = searchParams.get(key)

  if (raw == null || raw.length === 0) {
    if (options.required || options.defaultValue == null) {
      throw new ApiError(400, `Missing or invalid query param: ${key}`)
    }

    return options.defaultValue
  }

  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) {
    throw new ApiError(400, `Missing or invalid query param: ${key}`)
  }

  if (options.min != null && value < options.min) {
    throw new ApiError(400, `Missing or invalid query param: ${key}`)
  }

  if (options.max != null && value > options.max) {
    throw new ApiError(400, `Missing or invalid query param: ${key}`)
  }

  return value
}

export function getOptionalInt(
  searchParams: URLSearchParams,
  key: string,
  options: Omit<IntOptions, 'required'> = {},
): number | undefined {
  const raw = searchParams.get(key)
  if (raw == null || raw.length === 0) {
    return undefined
  }

  return getInt(searchParams, key, { ...options, required: true })
}

export function getBoolean(searchParams: URLSearchParams, key: string, defaultValue: boolean): boolean {
  const raw = searchParams.get(key)
  if (raw == null || raw.length === 0) {
    return defaultValue
  }

  const normalized = raw.toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }

  if (normalized === 'false' || normalized === '0') {
    return false
  }

  throw new ApiError(400, `Missing or invalid query param: ${key}`)
}

export function getStringArray(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: string[],
): string[] {
  const values = searchParams.getAll(key).filter((value) => value.length > 0)
  return values.length > 0 ? values : defaultValue
}
