import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loginStaff } from '../lib/auth'
import type { CurrentStaff } from '../types/staff'

const STORAGE_KEY = 'currentStaff'

interface StaffContextValue {
  staff: CurrentStaff | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ error: string | null }>
  logout: () => void
}

const StaffContext = createContext<StaffContextValue | null>(null)

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<CurrentStaff | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setStaff(JSON.parse(stored))
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    setLoading(false)
  }, [])

  async function login(username: string, password: string) {
    const { staff: loggedInStaff, error } = await loginStaff(username, password)
    if (loggedInStaff) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedInStaff))
      setStaff(loggedInStaff)
    }
    return { error }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
    setStaff(null)
  }

  return (
    <StaffContext.Provider value={{ staff, loading, login, logout }}>
      {children}
    </StaffContext.Provider>
  )
}

export function useStaff() {
  const ctx = useContext(StaffContext)
  if (!ctx) throw new Error('useStaff must be used within a StaffProvider')
  return ctx
}
