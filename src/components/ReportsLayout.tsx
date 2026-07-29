import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'

export function ReportsLayout() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-4">
          <Outlet />
        </main>
      </AppHeader>
    </div>
  )
}
