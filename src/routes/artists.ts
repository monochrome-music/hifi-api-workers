import { Hono } from 'hono'
import type { Bindings } from '../env'
import { API_VERSION, ARTIST_TRACK_CONCURRENCY } from '../constants'
import { getCountryCode } from '../env'
import { mapLimit } from '../lib/concurrency'
import { ApiError } from '../lib/errors'
import { getBoolean, getOptionalInt, getString } from '../lib/query'
import { tidalJsonRequest } from '../lib/tidal/client'
import { buildImageUrl, extractUuidFromTidalUrl } from '../lib/tidal/helpers'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/artist/similar', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getOptionalInt(searchParams, 'id')
  const cursor = getString(searchParams, 'cursor')

  if (id == null) {
    throw new ApiError(400, 'Missing or invalid query param: id')
  }

  const { data } = await tidalJsonRequest({
    env: c.env,
    url: `https://openapi.tidal.com/v2/artists/${id}/relationships/similarArtists`,
    params: {
      'page[cursor]': cursor,
      countryCode: getCountryCode(c.env),
      include: 'similarArtists,similarArtists.profileArt',
    },
  })

  const included = Array.isArray(data?.included) ? (data.included as any[]) : []
  const artistsMap = new Map(included.filter((item: any) => item?.type === 'artists').map((item: any) => [item.id, item]))
  const artworksMap = new Map(included.filter((item: any) => item?.type === 'artworks').map((item: any) => [item.id, item]))

  const artists = (data?.data ?? []).map((entry: any) => {
    const artistId = entry?.id
    const artist: any = artistsMap.get(artistId) ?? {}
    const attributes = artist.attributes ?? {}

    let picture = attributes.selectedAlbumCoverFallback
    const profileArtId = artist.relationships?.profileArt?.data?.[0]?.id
    if (profileArtId) {
      picture = extractUuidFromTidalUrl(artworksMap.get(profileArtId)?.attributes?.files?.[0]?.href) ?? picture
    }

    return {
      ...attributes,
      id: /^\d+$/.test(String(artistId)) ? Number(artistId) : artistId,
      picture,
      url: `http://www.tidal.com/artist/${artistId}`,
      relationType: 'SIMILAR_ARTIST',
    }
  })

  return c.json({
    version: API_VERSION,
    artists,
  })
})

app.get('/album/similar', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getOptionalInt(searchParams, 'id')
  const cursor = getString(searchParams, 'cursor')

  if (id == null) {
    throw new ApiError(400, 'Missing or invalid query param: id')
  }

  const { data } = await tidalJsonRequest({
    env: c.env,
    url: `https://openapi.tidal.com/v2/albums/${id}/relationships/similarAlbums`,
    params: {
      'page[cursor]': cursor,
      countryCode: getCountryCode(c.env),
      include: 'similarAlbums,similarAlbums.coverArt,similarAlbums.artists',
    },
  })

  const included = Array.isArray(data?.included) ? (data.included as any[]) : []
  const albumsMap = new Map(included.filter((item: any) => item?.type === 'albums').map((item: any) => [item.id, item]))
  const artworksMap = new Map(included.filter((item: any) => item?.type === 'artworks').map((item: any) => [item.id, item]))
  const artistsMap = new Map(included.filter((item: any) => item?.type === 'artists').map((item: any) => [item.id, item]))

  const albums = (data?.data ?? []).map((entry: any) => {
    const albumId = entry?.id
    const album: any = albumsMap.get(albumId) ?? {}
    const attributes = album.attributes ?? {}
    const coverArtId = album.relationships?.coverArt?.data?.[0]?.id
    const cover = coverArtId
      ? extractUuidFromTidalUrl(artworksMap.get(coverArtId)?.attributes?.files?.[0]?.href)
      : null

    const artistList = (album.relationships?.artists?.data ?? [])
      .map((artistEntry: any) => {
        const artist: any = artistsMap.get(artistEntry?.id)
        if (!artist) {
          return null
        }

        return {
          id: /^\d+$/.test(String(artist.id)) ? Number(artist.id) : artist.id,
          name: artist.attributes?.name,
        }
      })
      .filter(Boolean)

    return {
      ...attributes,
      id: /^\d+$/.test(String(albumId)) ? Number(albumId) : albumId,
      cover,
      artists: artistList,
      url: `http://www.tidal.com/album/${albumId}`,
    }
  })

  return c.json({
    version: API_VERSION,
    albums,
  })
})

app.get('/artist', async (c) => {
  const searchParams = new URL(c.req.url).searchParams
  const id = getOptionalInt(searchParams, 'id')
  const f = getOptionalInt(searchParams, 'f')
  const skipTracks = getBoolean(searchParams, 'skip_tracks', false)
  const countryCode = getCountryCode(c.env)

  if (id == null && f == null) {
    throw new ApiError(400, 'Provide id or f query param')
  }

  if (id != null) {
    const { data } = await tidalJsonRequest({
      env: c.env,
      url: `https://api.tidal.com/v1/artists/${id}`,
      params: { countryCode },
    })

    const picture = data.picture ?? data.selectedAlbumCoverFallback
    if (!data.picture && picture) {
      data.picture = picture
    }

    return c.json({
      version: API_VERSION,
      artist: data,
      cover: picture
        ? {
            id: data.id,
            name: data.name,
            '750': buildImageUrl(picture, '750x750'),
          }
        : null,
    })
  }

  const artistId = f as number
  const albumsUrl = `https://api.tidal.com/v1/artists/${artistId}/albums`

  const requests: Array<Promise<{ data: any; token: string }>> = [
    tidalJsonRequest({
      env: c.env,
      url: albumsUrl,
      params: { countryCode, limit: 100 },
    }),
    tidalJsonRequest({
      env: c.env,
      url: albumsUrl,
      params: { countryCode, limit: 100, filter: 'EPSANDSINGLES' },
    }),
  ]

  if (skipTracks) {
    requests.push(
      tidalJsonRequest({
        env: c.env,
        url: `https://api.tidal.com/v1/artists/${artistId}/toptracks`,
        params: { countryCode, limit: 15 },
      }),
    )
  }

  const results = await Promise.allSettled(requests)
  const releases: any[] = []
  const seenIds = new Set<number>()

  for (const result of results.slice(0, 2)) {
    if (result.status !== 'fulfilled') {
      continue
    }

    const items = Array.isArray(result.value.data?.items) ? result.value.data.items : result.value.data
    if (!Array.isArray(items)) {
      continue
    }

    for (const item of items) {
      if (item?.id && !seenIds.has(item.id)) {
        seenIds.add(item.id)
        releases.push(item)
      }
    }
  }

  const albums = { items: releases }

  if (skipTracks) {
    const topTracksResult = results[2]
    const tracks =
      topTracksResult?.status === 'fulfilled'
        ? Array.isArray(topTracksResult.value.data?.items)
          ? topTracksResult.value.data.items
          : topTracksResult.value.data
        : []

    return c.json({
      version: API_VERSION,
      albums,
      tracks: Array.isArray(tracks) ? tracks : [],
    })
  }

  if (releases.length === 0) {
    return c.json({
      version: API_VERSION,
      albums,
      tracks: [],
    })
  }

  const trackResults = await mapLimit(releases.map((release) => release.id), ARTIST_TRACK_CONCURRENCY, async (albumId) => {
    const { data } = await tidalJsonRequest({
      env: c.env,
      url: 'https://api.tidal.com/v1/pages/album',
      params: {
        albumId,
        countryCode,
        deviceType: 'BROWSER',
      },
    })

    const items = data?.rows?.[1]?.modules?.[0]?.pagedList?.items ?? []
    return items.map((item: any) => (typeof item === 'object' && item ? item.item ?? item : item))
  })

  return c.json({
    version: API_VERSION,
    albums,
    tracks: trackResults.flatMap((result) => (result instanceof Error ? [] : result)),
  })
})

export default app
