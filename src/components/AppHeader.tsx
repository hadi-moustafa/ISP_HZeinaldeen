import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X, LogOut } from 'lucide-react'
import { useStaff } from '../context/StaffContext'
import { isAdmin, isCollector } from '../lib/permissions'

const HeaderActionsContext = createContext<HTMLDivElement | null>(null)

// Lets a page (rendered inside a layout's <Outlet/>) put a button in the
// header, e.g. Subscribers' Export button next to the hamburger, without
// prop-drilling through the layout.
export function HeaderActions({ children }: { children: ReactNode }) {
  const node = useContext(HeaderActionsContext)
  if (!node) return null
  return createPortal(children, node)
}

// collectorHidden marks every link a collector account can't reach --
// ProtectedRoute enforces the actual restriction, this just keeps the menu
// from listing routes that would immediately bounce them back.
const navSections: {
  heading: string | null
  links: { to: string; label: string; adminOnly?: boolean; collectorHidden?: boolean }[]
}[] = [
  {
    heading: null,
    links: [
      { to: '/', label: 'Dashboard', collectorHidden: true },
      { to: '/subscribers', label: 'Subscribers' },
      { to: '/reports/monthly-log', label: 'Monthly Log', collectorHidden: true },
      { to: '/reports/financials', label: 'Financial Report', adminOnly: true, collectorHidden: true },
      { to: '/field', label: 'Field View (offline)', collectorHidden: true },
    ],
  },
  {
    heading: 'Reference data',
    links: [
      { to: '/admin/companies', label: 'Companies', collectorHidden: true },
      { to: '/admin/services', label: 'Services', collectorHidden: true },
      { to: '/admin/collectors', label: 'Collectors', collectorHidden: true },
      { to: '/admin/owners', label: 'Owners', collectorHidden: true },
      { to: '/admin/regions', label: 'Regions', collectorHidden: true },
      { to: '/admin/products', label: 'Products', collectorHidden: true },
      { to: '/admin/import', label: 'Import subscribers', collectorHidden: true },
      { to: '/admin/missing-data', label: 'Missing data', collectorHidden: true },
      { to: '/admin/duplicates', label: 'Duplicate subscribers', collectorHidden: true },
      { to: '/admin/company-payments', label: 'Company Payments', collectorHidden: true },
      { to: '/admin/activity-log', label: 'Activity Log', collectorHidden: true },
    ],
  },
]

// Wraps a layout's page content: renders the header (hamburger + title +
// portal target for HeaderActions) and the slide-out nav drawer, with
// `children` (typically <Outlet/>) rendered below.
export function AppHeader({ title = 'ISP Manager', children }: { title?: string; children: ReactNode }) {
  const { staff, logout } = useStaff()
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsNode, setActionsNode] = useState<HTMLDivElement | null>(null)

  return (
    <HeaderActionsContext.Provider value={actionsNode}>
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-3">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-700 active:bg-neutral-100"
        >
          <Menu size={22} />
        </button>
        <Link
          to={isCollector(staff) ? '/subscribers' : '/'}
          className="truncate font-semibold text-neutral-900"
        >
          {title}
        </Link>
        <div ref={setActionsNode} className="ml-auto flex shrink-0 items-center gap-2" />
      </header>

      {children}

      {menuOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <nav className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <span className="font-semibold text-neutral-900">Menu</span>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 active:bg-neutral-100"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 px-2 py-3">
              {navSections.map((section, i) => {
                const links = section.links.filter(
                  (l) => (!l.adminOnly || isAdmin(staff)) && (!l.collectorHidden || !isCollector(staff)),
                )
                if (links.length === 0) return null
                return (
                  <div key={i} className="mb-4">
                    {section.heading && (
                      <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {section.heading}
                      </p>
                    )}
                    {links.map((link) => (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        end={link.to === '/'}
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) =>
                          `block rounded-md px-3 py-2.5 text-sm font-medium ${
                            isActive ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-700 active:bg-neutral-100'
                          }`
                        }
                      >
                        {link.label}
                      </NavLink>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="border-t border-neutral-200 px-2 py-3">
              <p className="px-3 pb-2 text-xs text-neutral-400">
                Signed in as {staff?.username} ({staff?.role})
              </p>
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-red-600 active:bg-red-50"
              >
                <LogOut size={16} />
                Log out
              </button>
            </div>
          </nav>
        </div>
      )}
    </HeaderActionsContext.Provider>
  )
}
