export function extractUuidFromTidalUrl(href: string | undefined | null): string | null {
  const parts = href?.split('/') ?? []
  return parts.length >= 9 ? parts.slice(4, 9).join('-') : null
}

export function buildImageUrl(slug: string, size: string): string {
  return `https://resources.tidal.com/images/${slug.replaceAll('-', '/')}/${size}.jpg`
}
