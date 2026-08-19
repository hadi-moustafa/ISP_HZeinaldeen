// Segmented-control tab bar shared by the consolidated admin "hub" pages
// (Company, Products, Subscriber Tools) so related content lives on one
// page instead of forcing a nav-drawer trip per section. Horizontally
// scrollable so it never wraps awkwardly on a narrow phone screen.
export function PageTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}) {
  return (
    <div className="mb-4 flex gap-1 rounded-full bg-neutral-100 p-1 dark:bg-neutral-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
          className={`flex-1 truncate rounded-full px-1.5 py-2 text-[13px] font-semibold transition-colors ${
            active === t.key
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
