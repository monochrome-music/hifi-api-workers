import type { Bindings, TidalCredential } from '../../env'
import { API_VERSION } from '../../constants'
import { loadCredentials } from '../../env'
import { ApiError } from '../errors'
import { buildUrl, type QueryInput } from '../url'

interface CredentialEntry {
  key: string
  credential: TidalCredential
  accessToken: string | null
  expiresAt: number
  refreshPromise: Promise<string> | null
}

interface JsonRequestOptions {
  env: Bindings
  url: string
  params?: QueryInput
  cred?: CredentialEntry
}

interface RawRequestOptions extends JsonRequestOptions {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
}

const credentialEntries: CredentialEntry[] = []

const REQUEST_TIMEOUT_MS = 12_000
const TOKEN_TIMEOUT_MS = 8_000
const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_BASE_DELAY = 1.0
const RATE_LIMIT_MAX_DELAY = 10.0

function now() {
  return Date.now()
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

function credKey(cred: TidalCredential): string {
  return `${cred.clientId}:${cred.refreshToken}`
}

function getEntries(env: Bindings): CredentialEntry[] {
  const credentials = loadCredentials(env)
  const currentKeys = new Set(credentials.map(credKey))

  for (let i = credentialEntries.length - 1; i >= 0; i--) {
    if (!currentKeys.has(credentialEntries[i].key)) {
      credentialEntries.splice(i, 1)
    }
  }

  for (const cred of credentials) {
    const key = credKey(cred)
    if (!credentialEntries.some((e) => e.key === key)) {
      credentialEntries.push({
        key,
        credential: cred,
        accessToken: null,
        expiresAt: 0,
        refreshPromise: null,
      })
    }
  }

  return credentialEntries
}

function pickCredential(env: Bindings): CredentialEntry {
  const entries = getEntries(env)
  if (entries.length === 0) {
    throw new ApiError(500, 'No Tidal credentials available; configure TOKEN_JSON or CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN')
  }
  return entries[Math.floor(Math.random() * entries.length)]
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(504, 'Upstream timeout')
    }
    throw new ApiError(503, 'Connection error to Tidal')
  } finally {
    clearTimeout(timeout)
  }
}

async function refreshAccessToken(entry: CredentialEntry): Promise<string> {
  if (entry.accessToken && now() < entry.expiresAt) {
    return entry.accessToken
  }

  if (!entry.refreshPromise) {
    const cred = entry.credential
    entry.refreshPromise = (async () => {
      const body = new URLSearchParams({
        client_id: cred.clientId,
        grant_type: 'refresh_token',
        refresh_token: cred.refreshToken,
        scope: 'r_usr+w_usr+w_sub',
      })

      const response = await fetchWithTimeout(
        'https://auth.tidal.com/v1/oauth2/token',
        {
          method: 'POST',
          headers: {
            authorization: basicAuthorization(cred.clientId, cred.clientSecret),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        },
        TOKEN_TIMEOUT_MS,
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new ApiError(
          401,
          `Token refresh failed: ${response.status} ${response.statusText} ${errorText}`,
        )
      }

      const data = (await response.json()) as {
        access_token: string
        expires_in?: number
      }
      entry.accessToken = data.access_token
      entry.expiresAt = now() + ((data.expires_in ?? 3600) - 60) * 1000
      return data.access_token
    })().finally(() => {
      entry.refreshPromise = null
    })
  }

  return entry.refreshPromise
}

export async function getAccessToken(
  env: Bindings,
  entry?: CredentialEntry,
  forceRefresh = false,
): Promise<{ token: string; entry: CredentialEntry }> {
  const e = entry ?? pickCredential(env)
  if (!forceRefresh && e.accessToken && now() < e.expiresAt) {
    return { token: e.accessToken, entry: e }
  }

  const token = await refreshAccessToken(e)
  return { token, entry: e }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mapUpstreamError(response: Response): never {
  if (response.status === 404) {
    throw new ApiError(404, 'Resource not found')
  }
  throw new ApiError(response.status, 'Upstream API error')
}

export async function tidalJsonRequest(
  options: JsonRequestOptions,
): Promise<{ data: any; token: string; cred: CredentialEntry }> {
  let { token, entry: cred } = await getAccessToken(options.env, options.cred)
  const target = buildUrl(options.url, options.params)

  const doFetch = async (accessToken: string) =>
    fetchWithTimeout(
      target,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
      REQUEST_TIMEOUT_MS,
    )

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    let response = await doFetch(token)

    if (response.status === 401) {
      const refreshed = await getAccessToken(options.env, cred, true)
      token = refreshed.token
      cred = refreshed.entry
      response = await doFetch(token)
    }

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      let delay = Math.min(RATE_LIMIT_BASE_DELAY * Math.pow(2, attempt), RATE_LIMIT_MAX_DELAY) * 1000
      const retryAfter = response.headers.get('Retry-After')
      if (retryAfter) {
        const parsed = Number(retryAfter)
        if (!Number.isNaN(parsed) && parsed > 0) {
          delay = Math.min(delay, parsed * 1000)
        }
      }
      delay = Math.min(delay, RATE_LIMIT_MAX_DELAY * 1000)
      await sleep(delay)
      continue
    }

    if (response.status === 404) {
      const entries = getEntries(options.env)
      const otherCred = entries.find((e) => e.key !== cred.key)
      if (otherCred) {
        const refreshed = await getAccessToken(options.env, otherCred, true)
        const retryResponse = await doFetch(refreshed.token)
        if (retryResponse.ok) {
          return {
            data: await retryResponse.json(),
            token: refreshed.token,
            cred: refreshed.entry,
          }
        }
      }
      mapUpstreamError(response)
    }

    if (!response.ok) {
      mapUpstreamError(response)
    }

    return {
      data: await response.json(),
      token,
      cred,
    }
  }

  throw new ApiError(429, 'Upstream rate limited')
}

export async function makeVersionedGet(options: JsonRequestOptions) {
  const { data } = await tidalJsonRequest(options)
  return {
    version: API_VERSION,
    data,
  }
}

export async function tidalProxyRequest(
  options: RawRequestOptions,
): Promise<Response> {
  let { token, entry: cred } = await getAccessToken(options.env, options.cred)
  const target = buildUrl(options.url, options.params)

  const doFetch = async (accessToken: string) =>
    fetchWithTimeout(
      target,
      {
        method: options.method ?? 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(options.headers ?? {}),
        },
        body: options.body ?? null,
      },
      REQUEST_TIMEOUT_MS,
    )

  let response = await doFetch(token)
  if (response.status === 401) {
    const refreshed = await getAccessToken(options.env, cred, true)
    token = refreshed.token
    cred = refreshed.entry
    response = await doFetch(token)
  }

  return response
}
