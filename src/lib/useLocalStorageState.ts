import { useEffect, useState } from 'react'

// Same plain localStorage.getItem/setItem pattern already used for the
// staff login session (src/context/StaffContext.tsx) -- generalized into a
// drop-in useState replacement so a page's filter/sort state survives a
// real reload/navigation, not just in-session refetches.
export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch {
      // Storage full/unavailable (private browsing, quota) -- filters just
      // won't persist this session, not worth surfacing as an app error.
    }
  }, [key, value])

  return [value, setValue] as const
}
