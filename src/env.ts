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

  const clientIdDefault = env.CLIENT_ID?.trim() ?? ''
  const clientSecretDefault = env.CLIENT_SECRET?.trim() ?? ''
  const userIdDefault = env.USER_ID?.trim() ?? ''

  if (env.TOKEN_JSON?.trim()) {
    let parsed: any
    try {
      parsed = JSON.parse(env.TOKEN_JSON)
    } catch (e) {
      throw new Error(`TOKEN_JSON parse error: ${e instanceof Error ? e.message : String(e)}`)
    }

    const entries = Array.isArray(parsed) ? parsed : [parsed]
    for (const entry of entries) {
      const clientId = (entry.client_ID ?? entry.clientId ?? clientIdDefault ?? '').trim()
      const clientSecret = (entry.client_secret ?? entry.clientSecret ?? clientSecretDefault ?? '').trim()
      const refreshToken = (entry.refresh_token ?? entry.refreshToken ?? '').trim()
      const userId = (entry.userID ?? entry.user_id ?? entry.userId ?? userIdDefault ?? '').trim()

      if (refreshToken) {
        if (!clientId || !clientSecret) {
          throw new Error(
            `TOKEN_JSON entry missing client_ID/clientId or client_secret/clientSecret, and no CLIENT_ID/CLIENT_SECRET fallback is set`,
          )
        }
        credentials.push({ clientId, clientSecret, refreshToken, userId: userId || undefined })
      }
    }
  }

  if (credentials.length === 0 && clientIdDefault && clientSecretDefault) {
    for (const rt of (env.REFRESH_TOKEN ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      credentials.push({ clientId: clientIdDefault, clientSecret: clientSecretDefault, refreshToken: rt, userId: userIdDefault || undefined })
    }
  }

  return credentials
}
