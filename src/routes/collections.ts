import { Hono } from 'hono'
import type { Bindings } from '../env'
import { API_VERSION } from '../constants'
import { getCountryCode } from '../env'
import { ApiError } from '../lib/errors'
import { getInt, getOptionalInt, getRequiredString, getString } from '../lib/query'
import { tidalJsonRequest } from '../lib/tidal/client'
import { buildImageUrl } from '../lib/tidal/helpers'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/album', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getInt(searchParams, 'id', { required: true })
  const limit = getInt(searchParams, 'limit', { defaultValue: 100, min: 1, max: 500 })
  const offset = getInt(searchParams, 'offset', { defaultValue: 0, min: 0 })
  const countryCode = getCountryCode(c.env)

  const initial = await tidalJsonRequest({
    env: c.env,
    url: `https://api.tidal.com/v1/albums/${id}`,
    params: { countryCode },
  })

  const tasks: Array<Promise<{ data: any; token: string }>> = []
  let currentOffset = offset
  let remainingLimit = limit

  while (remainingLimit > 0) {
    const chunkSize = Math.min(remainingLimit, 100)
    tasks.push(
      tidalJsonRequest({
        env: c.env,
        url: `https://api.tidal.com/v1/albums/${id}/items`,
        params: { countryCode, limit: chunkSize, offset: currentOffset },
        token: initial.token,
      }),
    )
    currentOffset += chunkSize
    remainingLimit -= chunkSize
  }

  const itemPages = await Promise.all(tasks)
  const items: any[] = []

  for (const page of itemPages) {
    const pageItems = Array.isArray(page.data) ? page.data : page.data?.items
    if (Array.isArray(pageItems)) {
      items.push(...pageItems)
    }
  }

  initial.data.items = items

  return c.json({
    version: API_VERSION,
    data: initial.data,
  })
})

app.get('/mix', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getRequiredString(searchParams, 'id')
  const { data } = await tidalJsonRequest({
    env: c.env,
    url: 'https://api.tidal.com/v1/pages/mix',
    params: {
      mixId: id,
      countryCode: getCountryCode(c.env),
      deviceType: 'BROWSER',
    },
  })

  let mix: Record<string, unknown> = {}
  let items: any[] = []

  for (const row of data?.rows ?? []) {
    for (const module of row?.modules ?? []) {
      if (module?.type === 'MIX_HEADER') {
        mix = module.mix ?? {}
      } else if (module?.type === 'TRACK_LIST') {
        items = module?.pagedList?.items ?? []
      }
    }
  }

  return c.json({
    version: API_VERSION,
    mix,
    items: items.map((item) => (typeof item === 'object' && item ? item.item ?? item : item)),
  })
})

app.get('/playlist', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getRequiredString(searchParams, 'id')
  const limit = getInt(searchParams, 'limit', { defaultValue: 100, min: 1, max: 500 })
  const offset = getInt(searchParams, 'offset', { defaultValue: 0, min: 0 })
  const countryCode = getCountryCode(c.env)

  const [playlistData, itemsData] = await Promise.all([
    tidalJsonRequest({
      env: c.env,
      url: `https://api.tidal.com/v1/playlists/${id}`,
      params: { countryCode },
    }),
    tidalJsonRequest({
      env: c.env,
      url: `https://api.tidal.com/v1/playlists/${id}/items`,
      params: { countryCode, limit, offset },
    }),
  ])

  return c.json({
    version: API_VERSION,
    playlist: playlistData.data,
    items: itemsData.data?.items ?? itemsData.data,
  })
})

app.get('/cover', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getOptionalInt(searchParams, 'id')
  const q = getString(searchParams, 'q')

  if (id == null && q == null) {
    throw new ApiError(400, 'Provide id or q query param')
  }

  const countryCode = getCountryCode(c.env)

  const buildCoverEntry = (coverSlug: string, name: string | undefined, trackId: number | undefined) => ({
    id: trackId,
    name,
    '1280': buildImageUrl(coverSlug, '1280x1280'),
    '640': buildImageUrl(coverSlug, '640x640'),
    '80': buildImageUrl(coverSlug, '80x80'),
  })

  if (id != null) {
    const trackData = await tidalJsonRequest({
      env: c.env,
      url: `https://api.tidal.com/v1/tracks/${id}/`,
      params: { countryCode },
    })

    const album = trackData.data?.album ?? {}
    if (!album.cover) {
      throw new ApiError(404, 'Cover not found')
    }

    return c.json({
      version: API_VERSION,
      covers: [
        buildCoverEntry(album.cover, album.title ?? trackData.data?.title, album.id ?? id),
      ],
    })
  }

  const searchData = await tidalJsonRequest({
    env: c.env,
    url: 'https://api.tidal.com/v1/search/tracks',
    params: {
      countryCode,
      query: q ?? '',
      limit: 10,
    },
  })

  const items = Array.isArray(searchData.data?.items) ? searchData.data.items.slice(0, 10) : []
  if (items.length === 0) {
    throw new ApiError(404, 'Cover not found')
  }

  const covers = items
    .map((track: any) => {
      const album = track?.album ?? {}
      if (!album.cover) {
        return null
      }

      return buildCoverEntry(album.cover, track?.title, track?.id)
    })
    .filter(Boolean)

  if (covers.length === 0) {
    throw new ApiError(404, 'Cover not found')
  }

  return c.json({
    version: API_VERSION,
    covers,
  })
})

export default app
