import { readFile, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'

const ENV_FILE = '.dev.vars'
const DEFAULT_SCOPE = 'r_usr+w_usr+w_sub'
const AUTHORIZATION_ENDPOINT = 'https://auth.tidal.com/v1/oauth2/device_authorization'
const TOKEN_ENDPOINT = 'https://auth.tidal.com/v1/oauth2/token'
const CREDENTIALS_GIST_URL = 'https://api.github.com/gists/48d01f5a24b4b7b37f19443977c22cd6'
const BUILTIN_CLIENT_ID = atob('ZlgySnhkbW50WldLMGl4VA==')
const BUILTIN_CLIENT_SECRET = atob('MU5tNUFmREFqeHJnSkZKYktOV0xlQXlLR1ZHbUlOdVhQUExIVlhBdnhBZz0=')
const DEVICE_AUTH_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 8.0.0; SM-G965F Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.109 Mobile Safari/537.36'

type EnvMap = Record<string, string>
type TidalCredential = {
  clientId: string
  clientSecret: string
}
type DeviceAuthorizationResponse = {
  deviceCode: string
  userCode?: string
  verificationUri?: string
  verificationUriComplete?: string
  interval?: number
  expiresIn?: number
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

function parseDotEnv(text: string): EnvMap {
  const values: EnvMap = {}

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

async function loadEnvFile(pathname: string): Promise<{ raw: string; values: EnvMap }> {
  try {
    const raw = await readFile(pathname, 'utf8')
    return { raw, values: parseDotEnv(raw) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { raw: '', values: {} }
    }

    throw error
  }
}

async function openBrowser(url: string): Promise<boolean> {
  const commands =
    platform() === 'darwin'
      ? [['open', url]]
      : platform() === 'linux'
        ? [['xdg-open', url]]
        : platform() === 'win32'
          ? [['cmd', '/c', 'start', '', url]]
          : []

  for (const command of commands) {
    const proc = Bun.spawn(command, {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    const exitCode = await proc.exited
    if (exitCode === 0) {
      return true
    }
  }

  return false
}

function buildVerificationUrl(input: {
  clientId: string
  scope: string
  verificationUriComplete?: string
  verificationUri?: string
  userCode?: string
}): string {
  if (input.verificationUriComplete) {
    return input.verificationUriComplete
  }

  const url = new URL(input.verificationUri ?? 'https://link.tidal.com')
  if (input.userCode) {
    url.searchParams.set('code', input.userCode)
  }
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('scope', input.scope)
  return url.toString()
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text()
  if (text.length === 0) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function shuffle<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[items[index], items[swapIndex]] = [items[swapIndex], items[index]]
  }
}

async function fetchCredentials(): Promise<TidalCredential[]> {
  const response = await fetch(CREDENTIALS_GIST_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'hifi-api-workers',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch TIDAL credentials gist: ${response.status} ${response.statusText}`)
  }

  const gistData = (await response.json()) as {
    files?: Record<string, { content?: string }>
  }
  const content = gistData.files?.['tidal-api-key.json']?.content
  if (!content) {
    throw new Error('Missing tidal-api-key.json in credentials gist')
  }

  const parsed = JSON.parse(content) as {
    keys?: Array<{
      clientId?: string
      clientSecret?: string
      formats?: string
      valid?: string
    }>
  }

  const hifiCreds: TidalCredential[] = [
    {
      clientId: BUILTIN_CLIENT_ID,
      clientSecret: BUILTIN_CLIENT_SECRET,
    },
  ]
  const otherCreds: TidalCredential[] = []

  for (const keyEntry of parsed.keys ?? []) {
    if (keyEntry.valid !== 'True' || !keyEntry.clientId || !keyEntry.clientSecret) {
      continue
    }

    const credential = {
      clientId: keyEntry.clientId,
      clientSecret: keyEntry.clientSecret,
    }

    if ((keyEntry.formats ?? '').toLowerCase().includes('hifi')) {
      hifiCreds.push(credential)
    } else {
      otherCreds.push(credential)
    }
  }

  shuffle(hifiCreds)
  shuffle(otherCreds)

  return [...hifiCreds, ...otherCreds]
}

async function requestDeviceAuthorization(input: {
  clientId: string
  scope: string
}): Promise<{ response: Response; data: any }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    scope: input.scope,
  })

  const response = await fetch(AUTHORIZATION_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': DEVICE_AUTH_USER_AGENT,
    },
    body,
  })

  return {
    response,
    data: await parseJsonResponse(response),
  }
}

async function pollForTokens(input: {
  clientId: string
  clientSecret: string
  deviceCode: string
  scope: string
  intervalSeconds?: number
  expiresInSeconds?: number
}): Promise<any> {
  const authorization = basicAuthorization(input.clientId, input.clientSecret)
  const pollIntervalMs = Math.max(1, input.intervalSeconds ?? 5) * 1000
  const deadline = Date.now() + Math.max(1, input.expiresInSeconds ?? 900) * 1000

  while (Date.now() < deadline) {
    const body = new URLSearchParams({
      client_id: input.clientId,
      scope: input.scope,
      device_code: input.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const data = await parseJsonResponse(response)

    if (response.ok) {
      return data
    }

    const errorCode = typeof data?.error === 'string' ? data.error : null
    if (response.status === 400 && (errorCode === 'authorization_pending' || errorCode === 'slow_down')) {
      const extraDelayMs = errorCode === 'slow_down' ? pollIntervalMs : 0
      await Bun.sleep(pollIntervalMs + extraDelayMs)
      continue
    }

    throw new Error(
      `Token polling failed:\n${JSON.stringify(
        {
          status: response.status,
          statusText: response.statusText,
          response: data,
        },
        null,
        2,
      )}`,
    )
  }

  throw new Error('Timed out waiting for TIDAL device authorization')
}

async function writeEnvValues(raw: string, values: EnvMap): Promise<void> {
  let nextRaw = raw

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    nextRaw = pattern.test(nextRaw)
      ? nextRaw.replace(pattern, line)
      : `${nextRaw.replace(/\s*$/u, '\n')}${line}\n`
  }

  await writeFile(ENV_FILE, nextRaw, 'utf8')
}

async function main(): Promise<void> {
  const { raw } = await loadEnvFile(ENV_FILE)
  const scope = DEFAULT_SCOPE
  const credentials = await fetchCredentials()

  let selectedCredential: TidalCredential | null = null
  let auth: DeviceAuthorizationResponse | null = null

  for (const credential of credentials) {
    console.log(`Trying Client ID: ${credential.clientId}`)

    try {
      const result = await requestDeviceAuthorization({
        clientId: credential.clientId,
        scope,
      })

      if (result.response.status === 200) {
        selectedCredential = credential
        auth = result.data as DeviceAuthorizationResponse
        break
      }

      if (result.response.status === 401) {
        console.log(`Client ID ${credential.clientId} failed with 401. Trying next...`)
        continue
      }

      console.log(`Error ${result.response.status}. Trying next...`)
    } catch (error) {
      console.log(`Exception: ${error instanceof Error ? error.message : String(error)}. Trying next...`)
    }
  }

  if (!selectedCredential || !auth) {
    throw new Error('All TIDAL credentials failed')
  }

  const verifyUrl = buildVerificationUrl({
    clientId: selectedCredential.clientId,
    scope,
    verificationUriComplete: auth.verificationUriComplete,
    verificationUri: auth.verificationUri,
    userCode: auth.userCode,
  })

  console.log(
    JSON.stringify(
      {
        device_authorization_endpoint: AUTHORIZATION_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        scope,
        client_id: selectedCredential.clientId,
        verification_url: verifyUrl,
        user_code: auth.userCode,
      },
      null,
      2,
    ),
  )

  const opened = await openBrowser(verifyUrl)
  if (!opened) {
    console.log(verifyUrl)
  }

  const tokens = await pollForTokens({
    clientId: selectedCredential.clientId,
    clientSecret: selectedCredential.clientSecret,
    deviceCode: auth.deviceCode,
    scope,
    intervalSeconds: auth.interval,
    expiresInSeconds: auth.expiresIn,
  })

  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned by TIDAL')
  }

  await writeEnvValues(raw, {
    CLIENT_ID: selectedCredential.clientId,
    CLIENT_SECRET: selectedCredential.clientSecret,
    REFRESH_TOKEN: tokens.refresh_token,
  })
  console.log(tokens.refresh_token)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
