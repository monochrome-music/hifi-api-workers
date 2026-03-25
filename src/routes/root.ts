import { Hono } from 'hono'
import type { Bindings } from '../env'
import { API_VERSION, REPO_URL } from '../constants'

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.get('/', (c) => {
  return c.json({
    version: API_VERSION,
    Repo: REPO_URL,
  })
})

export default app
