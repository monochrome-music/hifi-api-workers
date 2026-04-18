import { DEFAULT_COUNTRY_CODE } from './constants'

export interface TidalCredential {
  clientId: string
  clientSecret: string
  refreshToken: string
  userId?: string
}

declare global {
  interface Env {
    COUNTRY_CODE?: string
    CLIENT_ID?: string
    CLIENT_SECRET?: string
    REFRESH_TOKEN?: string
    USER_ID?: string
    TOKEN_JSON?: string
  }
}

export type Bindings = Env

export function getCountryCode(env: Bindings): string {
  return env.COUNTRY_CODE ?? DEFAULT_COUNTRY_CODE
}

export function loadCredentials(env: Bindings): TidalCredential[] {
  const credentials: TidalCredential[] = []

  if (env.TOKEN_JSON?.trim()) {
    try {
      const parsed = JSON.parse(env.TOKEN_JSON)
      const entries = Array.isArray(parsed) ? parsed : [parsed]
      for (const entry of entries) {
        const clientId = (entry.client_ID ?? entry.clientId ?? env.CLIENT_ID ?? '').trim()
        const clientSecret = (entry.client_secret ?? entry.clientSecret ?? env.CLIENT_SECRET ?? '').trim()
        const refreshToken = (entry.refresh_token ?? entry.refreshToken ?? '').trim()
        const userId = (entry.userID ?? entry.user_id ?? entry.userId ?? env.USER_ID ?? '').trim()

        if (clientId && clientSecret && refreshToken) {
          credentials.push({ clientId, clientSecret, refreshToken, userId: userId || undefined })
        }
      }
    } catch {}
  }

  if (credentials.length === 0) {
    const clientId = env.CLIENT_ID?.trim()
    const clientSecret = env.CLIENT_SECRET?.trim()
    const refreshToken = env.REFRESH_TOKEN?.trim()
    const userId = env.USER_ID?.trim()

    if (clientId && clientSecret && refreshToken) {
      credentials.push({ clientId, clientSecret, refreshToken, userId: userId || undefined })
    }
  }

  return credentials
}
