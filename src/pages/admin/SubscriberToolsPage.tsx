import { useSearchParams } from 'react-router-dom'
import { PageTabs } from '../../components/PageTabs'
import { ImportPage } from './ImportPage'
import { MissingDataPage } from './MissingDataPage'
import { DuplicateSubscribersPage } from './DuplicateSubscribersPage'

type ToolsTab = 'import' | 'missing' | 'duplicates'
const TABS: { key: ToolsTab; label: string }[] = [
  { key: 'import', label: 'Import' },
  { key: 'missing', label: 'Missing data' },
  { key: 'duplicates', label: 'Duplicates' },
]

// Excel import, missing-data cleanup, and duplicate review are all
// subscriber-data hygiene tasks that used to live on three separate
// routes. One page, three tabs -- ?tab=missing deep-links from the
// import wizard's own "review missing data" follow-up link.
export function SubscriberToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as ToolsTab | null) ?? 'import'
  const active: ToolsTab = TABS.some((t) => t.key === tab) ? tab : 'import'

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Subscriber tools</h1>
      <PageTabs tabs={TABS} active={active} onChange={(key) => setSearchParams({ tab: key })} />

      {active === 'import' && <ImportPage />}
      {active === 'missing' && <MissingDataPage />}
      {active === 'duplicates' && <DuplicateSubscribersPage />}
    </div>
  )
}
