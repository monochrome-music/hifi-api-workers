export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<R | Error>> {
  const results: Array<R | Error> = new Array(items.length)
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1

      try {
        results[currentIndex] = await worker(items[currentIndex])
      } catch (error) {
        results[currentIndex] = error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}
