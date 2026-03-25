import { Hono } from 'hono'
import type { Bindings } from '../env'
import { API_VERSION, DEFAULT_COUNTRY_CODE } from '../constants'
import { getInt, getString } from '../lib/query'
import { tidalJsonRequest } from '../lib/tidal/client'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/topvideos', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const countryCode = getString(searchParams, 'countryCode') ?? DEFAULT_COUNTRY_CODE
  const locale = getString(searchParams, 'locale') ?? 'en_US'
  const deviceType = getString(searchParams, 'deviceType') ?? 'BROWSER'
  const limit = getInt(searchParams, 'limit', { defaultValue: 25, min: 1, max: 100 })
  const offset = getInt(searchParams, 'offset', { defaultValue: 0, min: 0 })

  const { data } = await tidalJsonRequest({
    env: c.env,
    url: 'https://api.tidal.com/v1/pages/mymusic_recommended_videos',
    params: {
      countryCode,
      locale,
      deviceType,
    },
  })

  const videos: any[] = []

  for (const row of data?.rows ?? []) {
    for (const module of row?.modules ?? []) {
      const type = module?.type
      if (type === 'VIDEO_PLAYLIST' || type === 'VIDEO_ROW' || type === 'PAGED_LIST') {
        for (const item of module?.pagedList?.items ?? []) {
          videos.push(item?.item ?? item)
        }
      } else if (type === 'VIDEO' || String(type ?? '').toLowerCase().includes('video')) {
        if (module?.item && typeof module.item === 'object') {
          videos.push(module.item)
        }
      }
    }
  }

  return c.json({
    version: API_VERSION,
    videos: videos.slice(offset, offset + limit),
    total: videos.length,
  })
})

app.get('/video', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })
  const quality = getString(searchParams, 'quality') ?? 'HIGH'
  const mode = getString(searchParams, 'mode') ?? 'STREAM'
  const presentation = getString(searchParams, 'presentation') ?? 'FULL'

  const { data } = await tidalJsonRequest({
    env: c.env,
    url: `https://api.tidal.com/v1/videos/${id}/playbackinfo`,
    params: {
      videoquality: quality,
      playbackmode: mode,
      assetpresentation: presentation,
    },
  })

  return c.json({
    version: API_VERSION,
    video: data,
  })
})

export default app
