import { DEFAULT_COUNTRY_CODE } from './constants'

declare global {
  interface Env {
    COUNTRY_CODE?: string
    CLIENT_ID?: string
    CLIENT_SECRET?: string
    REFRESH_TOKEN?: string
  }
}

export type Bindings = Env

export function getCountryCode(env: Bindings): string {
  return env.COUNTRY_CODE ?? DEFAULT_COUNTRY_CODE
}

export function getTidalCredentials(env: Bindings) {
  const clientId = env.CLIENT_ID?.trim()
  const clientSecret = env.CLIENT_SECRET?.trim()
  const refreshToken = env.REFRESH_TOKEN?.trim()

  if (!clientId || !clientSecret || !refreshToken) {
    return null
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
  }
}
