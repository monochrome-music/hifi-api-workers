import { Hono } from 'hono'
import type { Bindings } from '../env'
import { API_VERSION, DEFAULT_TRACK_FORMATS } from '../constants'
import { getCountryCode } from '../env'
import { ApiError } from '../lib/errors'
import { getBoolean, getInt, getRequiredString, getString, getStringArray } from '../lib/query'
import { makeVersionedGet, tidalJsonRequest, tidalProxyRequest } from '../lib/tidal/client'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/info', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })

  return c.json(
    await makeVersionedGet({
      env: c.env,
      url: `https://api.tidal.com/v1/tracks/${id}/`,
      params: { countryCode: getCountryCode(c.env) },
    }),
  )
})

app.get('/track', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })
  const quality = getString(searchParams, 'quality') ?? 'HI_RES_LOSSLESS'
  const immersiveAudio = getBoolean(searchParams, 'immersiveaudio', false)

  return c.json(
    await makeVersionedGet({
      env: c.env,
      url: `https://api.tidal.com/v1/tracks/${id}/playbackinfo`,
      params: {
        audioquality: quality,
        playbackmode: 'STREAM',
        assetpresentation: 'FULL',
        immersiveaudio: immersiveAudio,
      },
    }),
  )
})

app.get('/trackManifests', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getRequiredString(searchParams, 'id')
  const formats = getStringArray(searchParams, 'formats', DEFAULT_TRACK_FORMATS)
  const adaptive = getString(searchParams, 'adaptive') ?? 'true'
  const manifestType = getString(searchParams, 'manifestType') ?? 'MPEG_DASH'
  const uriScheme = getString(searchParams, 'uriScheme') ?? 'HTTPS'
  const usage = getString(searchParams, 'usage') ?? 'PLAYBACK'

  const params: Array<[string, string]> = [
    ['adaptive', adaptive],
    ['manifestType', manifestType],
    ['uriScheme', uriScheme],
    ['usage', usage],
  ]

  for (const format of formats) {
    params.push(['formats', format])
  }

  const payload = await makeVersionedGet({
    env: c.env,
    url: `https://openapi.tidal.com/v2/trackManifests/${id}`,
    params,
  })

  const drmData = payload.data?.data?.attributes?.drmData
  if (drmData && typeof drmData === 'object') {
    const proxyUrl = `${new URL(c.req.url).origin}/widevine`
    drmData.licenseUrl = proxyUrl
    drmData.certificateUrl = proxyUrl
  }

  return c.json(payload)
})

app.all('/widevine', async (c) => {
  try {
    const response = await tidalProxyRequest({
      env: c.env,
      url: 'https://api.tidal.com/v2/widevine',
      method: c.req.method,
      headers: {
        'content-type': c.req.header('content-type') ?? 'application/octet-stream',
      },
      body: c.req.method === 'GET' ? null : await c.req.arrayBuffer(),
    })

    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError(502, 'Error communicating with widevine server')
  }
})

app.get('/recommendations', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })

  return c.json(
    await makeVersionedGet({
      env: c.env,
      url: `https://api.tidal.com/v1/tracks/${id}/recommendations`,
      params: {
        limit: 20,
        countryCode: getCountryCode(c.env),
      },
    }),
  )
})

app.get('/lyrics', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })
  const { data } = await tidalJsonRequest({
    env: c.env,
    url: `https://api.tidal.com/v1/tracks/${id}/lyrics`,
    params: {
      countryCode: getCountryCode(c.env),
      locale: 'en_US',
      deviceType: 'BROWSER',
    },
  })

  if (!data) {
    throw new ApiError(404, 'Lyrics not found')
  }

  return c.json({
    version: API_VERSION,
    lyrics: data,
  })
})

export default app
