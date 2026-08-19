import { useSearchParams } from 'react-router-dom'
import { PageTabs } from '../../components/PageTabs'
import { ProductsPage } from './ProductsPage'
import { ProductSalePage } from './ProductSalePage'

type ProductsTab = 'inventory' | 'sell'
const TABS: { key: ProductsTab; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'sell', label: 'Sell' },
]

// Managing stock and selling it used to be two separate routes. One page,
// two tabs -- ?tab=sell deep-links from the dashboard's "Sell" button.
export function ProductsHubPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as ProductsTab | null) ?? 'inventory'
  const active: ProductsTab = TABS.some((t) => t.key === tab) ? tab : 'inventory'

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Products</h1>
      <PageTabs tabs={TABS} active={active} onChange={(key) => setSearchParams({ tab: key })} />

      {active === 'inventory' && <ProductsPage />}
      {active === 'sell' && <ProductSalePage />}
    </div>
  )
}
