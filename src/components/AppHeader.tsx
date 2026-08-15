import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X, LogOut, ChevronDown } from 'lucide-react'
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

type NavLinkItem = { to: string; label: string; adminOnly?: boolean; collectorHidden?: boolean }

// Everyday pages the whole staff uses -- kept flat and always visible, one
// tap away, never buried in a dropdown.
const primaryLinks: NavLinkItem[] = [
  { to: '/', label: 'Dashboard', collectorHidden: true },
  { to: '/subscribers', label: 'Subscribers' },
  { to: '/dabdabeh', label: 'Dabdabeh' },
  { to: '/reports/monthly-log', label: 'Monthly Log', collectorHidden: true },
  { to: '/reports/financials', label: 'Financial Report', adminOnly: true, collectorHidden: true },
  { to: '/field', label: 'Field View (offline)', collectorHidden: true },
]

// Admin-only, lower-frequency pages -- grouped into collapsible dropdowns
// by what they're for, instead of one long flat list.
const groups: { key: string; heading: string; links: NavLinkItem[] }[] = [
  {
    key: 'reference',
    heading: 'Reference data',
    links: [
      { to: '/admin/companies', label: 'Companies', collectorHidden: true },
      { to: '/admin/services', label: 'Services', collectorHidden: true },
      { to: '/admin/collectors', label: 'Collectors', collectorHidden: true },
      { to: '/admin/owners', label: 'Owners', collectorHidden: true },
      { to: '/admin/addresses', label: 'Addresses', collectorHidden: true },
      { to: '/admin/products', label: 'Products', collectorHidden: true },
    ],
  },
  {
    key: 'subscriber-tools',
    heading: 'Subscriber tools',
    links: [
      { to: '/admin/import', label: 'Import subscribers', collectorHidden: true },
      { to: '/admin/missing-data', label: 'Missing data', collectorHidden: true },
      { to: '/admin/duplicates', label: 'Duplicate subscribers', collectorHidden: true },
    ],
  },
  {
    key: 'finance',
    heading: 'Finance & activity',
    links: [
      { to: '/admin/company-payments', label: 'Company Payments', collectorHidden: true },
      { to: '/admin/activity-log', label: 'Activity Log', collectorHidden: true },
    ],
  },
]

function visibleLinks(links: NavLinkItem[], staff: ReturnType<typeof useStaff>['staff']) {
  return links.filter((l) => (!l.adminOnly || isAdmin(staff)) && (!l.collectorHidden || !isCollector(staff)))
}

// Wraps a layout's page content: renders the header (hamburger + title +
// portal target for HeaderActions) and the slide-out nav drawer, with
// `children` (typically <Outlet/>) rendered below.
export function AppHeader({ title = 'ISP Manager', children }: { title?: string; children: ReactNode }) {
  const { staff, logout } = useStaff()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsNode, setActionsNode] = useState<HTMLDivElement | null>(null)
  // A group starts open if the current page lives inside it, so navigating
  // there and reopening the menu doesn't hide where you are.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.links.some((l) => location.pathname.startsWith(l.to))).map((g) => g.key)),
  )

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visiblePrimary = visibleLinks(primaryLinks, staff)

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

      <div
        className={`fixed inset-0 z-40 flex transition-opacity duration-200 ${
          menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
        <nav
          className={`relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-200 ease-out ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
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
              {visiblePrimary.length > 0 && (
                <div className="mb-4">
                  {visiblePrimary.map((link) => (
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
              )}

              {groups.map((group) => {
                const links = visibleLinks(group.links, staff)
                if (links.length === 0) return null
                const isOpen = openGroups.has(group.key)
                return (
                  <div key={group.key} className="mb-1">
                    <button
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-semibold text-neutral-600 active:bg-neutral-100"
                    >
                      {group.heading}
                      <ChevronDown
                        size={16}
                        className={`text-neutral-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${
                        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        {links.map((link) => (
                          <NavLink
                            key={link.to}
                            to={link.to}
                            onClick={() => setMenuOpen(false)}
                            className={({ isActive }) =>
                              `block rounded-md py-2 pl-6 pr-3 text-sm font-medium ${
                                isActive ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-700 active:bg-neutral-100'
                              }`
                            }
                          >
                            {link.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
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
    </HeaderActionsContext.Provider>
  )
}
