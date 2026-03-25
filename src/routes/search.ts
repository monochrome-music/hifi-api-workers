import { Hono } from 'hono'
import type { Bindings } from '../env'
import { getCountryCode } from '../env'
import { ApiError } from '../lib/errors'
import { getInt, getString } from '../lib/query'
import { makeVersionedGet } from '../lib/tidal/client'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/search', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const s = getString(searchParams, 's')
  const a = getString(searchParams, 'a')
  const al = getString(searchParams, 'al')
  const v = getString(searchParams, 'v')
  const p = getString(searchParams, 'p')
  const i = getString(searchParams, 'i')?.trim()
  const offset = getInt(searchParams, 'offset', { defaultValue: 0, min: 0 })
  const limit = getInt(searchParams, 'limit', { defaultValue: 25, min: 1, max: 500 })
  const countryCode = getCountryCode(c.env)

  if (i) {
    let response: { version: string; data: any } | null = null

    try {
      response = await makeVersionedGet({
        env: c.env,
        url: 'https://api.tidal.com/v1/tracks',
        params: {
          'filter[isrc]': i,
          limit,
          offset,
          countryCode,
        },
      })
    } catch (error) {
      if (!(error instanceof ApiError) || ![400, 404].includes(error.status)) {
        throw error
      }
    }

    const payload = response?.data
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : []

    if (items.length > 0) {
      return c.json(response)
    }

    return c.json(
      await makeVersionedGet({
        env: c.env,
        url: 'https://api.tidal.com/v1/search/tracks',
        params: {
          query: i,
          limit,
          offset,
          countryCode,
        },
      }),
    )
  }

  const queries: Array<[string | undefined, string, Record<string, string | number>]> = [
    [s, 'https://api.tidal.com/v1/search/tracks', { query: s ?? '', limit, offset, countryCode }],
    [
      a,
      'https://api.tidal.com/v1/search/top-hits',
      { query: a ?? '', limit, offset, types: 'ARTISTS,TRACKS', countryCode },
    ],
    [al, 'https://api.tidal.com/v1/search/top-hits', { query: al ?? '', limit, offset, types: 'ALBUMS', countryCode }],
    [v, 'https://api.tidal.com/v1/search/top-hits', { query: v ?? '', limit, offset, types: 'VIDEOS', countryCode }],
    [p, 'https://api.tidal.com/v1/search/top-hits', { query: p ?? '', limit, offset, types: 'PLAYLISTS', countryCode }],
  ]

  for (const [value, url, params] of queries) {
    if (value) {
      return c.json(await makeVersionedGet({ env: c.env, url, params }))
    }
  }

  throw new ApiError(400, 'Provide one of s, a, al, v, p, or i')
})

export default app
