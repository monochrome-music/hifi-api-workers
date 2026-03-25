# hifi-api-workers

`hifi-api-workers` is a Cloudflare Workers port of [`binimum/hifi-api`](https://github.com/binimum/hifi-api).

It exposes the same HTTP API shape as the Python version.

This repo is intended to be a drop-in HTTP replacement for the Python `hifi-api` for *most* clients.

## License

GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).

## Setup

Install dependencies:

```bash
bun i
```

Create TIDAL creds:

```bash
bun run oauth:tidal
```

Run locally:

```bash
bun run dev
```

## Deploy

Deploy with Wrangler:

```bash
bun run deploy
```

Before or after deploy, add the required Worker secrets:

```bash
wrangler secret put CLIENT_ID
wrangler secret put CLIENT_SECRET
wrangler secret put REFRESH_TOKEN
```

If you want to override the default country, add `COUNTRY_CODE` as a Worker var in the Cloudflare dashboard or in `wrangler.toml`.

## Endpoints

The Worker exposes the same main endpoints as the Python API:

- `GET /`
- `GET /info`
- `GET /track`
- `GET /trackManifests`
- `ALL /widevine`
- `GET /recommendations`
- `GET /search`
- `GET /album`
- `GET /mix`
- `GET /playlist`
- `GET /cover`
- `GET /artist`
- `GET /artist/similar`
- `GET /album/similar`
- `GET /lyrics`
- `GET /topvideos`
- `GET /video`
