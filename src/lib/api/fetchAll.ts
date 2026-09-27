// PostgREST caps every response at 1000 rows (the project's max-rows
// setting), silently -- past that, lists would just stop. Pages through
// with .range() until a short page comes back. `page` must build a fresh,
// ordered query each call (a query builder can only be awaited once).
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    all.push(...rows)
    if (rows.length < PAGE_SIZE) return all
  }
}
