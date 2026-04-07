import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './env'
import { isApiError } from './lib/errors'
import artistRoutes from './routes/artists'
import collectionRoutes from './routes/collections'
import rootRoutes from './routes/root'
import searchRoutes from './routes/search'
import trackRoutes from './routes/tracks'
import videoRoutes from './routes/videos'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.use(
  '*',
  cors({
    origin: (origin) => {
      try {
        const url = new URL(origin)
        if (url.hostname.endsWith('.squid.wtf')) {
          return 'null'
        }
      } catch {}
      return origin
    },
  })
)

app.route('', rootRoutes)
app.route('', trackRoutes)
app.route('', searchRoutes)
app.route('', collectionRoutes)
app.route('', artistRoutes)
app.route('', videoRoutes)

app.notFound((c) => c.json({ detail: 'Not Found' }, 404))

app.onError((error, c) => {
  if (isApiError(error)) {
    return new Response(JSON.stringify({ detail: error.detail }), {
      status: error.status,
      headers: {
        'content-type': 'application/json',
        ...(error.headers ?? {}),
      },
    })
  }

  console.error(error)
  return c.json({ detail: 'Internal Server Error' }, 500)
})

export default app
