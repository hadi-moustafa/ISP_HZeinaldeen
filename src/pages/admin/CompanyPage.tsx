import { useSearchParams } from 'react-router-dom'
import { PageTabs } from '../../components/PageTabs'
import { CompaniesPage } from './CompaniesPage'
import { ServicesPage } from './ServicesPage'
import { CompanyPaymentsPage } from './CompanyPaymentsPage'
import { CompanyPaymentsAnalysisPage } from './CompanyPaymentsAnalysisPage'

type CompanyTab = 'companies' | 'services' | 'payments' | 'analysis'
const TABS: { key: CompanyTab; label: string }[] = [
  { key: 'companies', label: 'Companies' },
  { key: 'services', label: 'Services' },
  { key: 'payments', label: 'Payments' },
  { key: 'analysis', label: 'Analysis' },
]

// Companies, their services, what's owed to them, and payment analysis
// used to be four separate pages/routes -- all clicks-away from each
// other despite being the same subject ("everything about a company").
// Consolidated into one page with tabs (?tab= deep-linkable, e.g. from
// the dashboard's "Full analysis" link) so switching between them is a
// tap, not a trip back through the nav drawer.
export function CompanyPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as CompanyTab | null) ?? 'companies'
  const active: CompanyTab = TABS.some((t) => t.key === tab) ? tab : 'companies'

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Company</h1>
      <PageTabs tabs={TABS} active={active} onChange={(key) => setSearchParams({ tab: key })} />

      {active === 'companies' && <CompaniesPage />}
      {active === 'services' && <ServicesPage />}
      {active === 'payments' && <CompanyPaymentsPage />}
      {active === 'analysis' && <CompanyPaymentsAnalysisPage />}
    </div>
  )
}
