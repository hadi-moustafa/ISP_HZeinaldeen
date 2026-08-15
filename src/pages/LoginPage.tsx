import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'

export function LoginPage() {
  const { staff, login } = useStaff()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (staff) {
    const defaultLanding = staff.role === 'collector' ? '/subscribers' : '/'
    const from = (location.state as { from?: string })?.from ?? defaultLanding
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await login(username, password)
    if (error) setError(error)
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-900">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow dark:bg-neutral-800"
      >
        <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          ISP Manager
        </h1>

        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          placeholder="Username"
          className="mb-4 w-full rounded-md border border-neutral-300 px-3 py-3 text-base dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100"
          required
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="Password"
          className="mb-4 w-full rounded-md border border-neutral-300 px-3 py-3 text-base dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100"
          required
        />

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-4 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
