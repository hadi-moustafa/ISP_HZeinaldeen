# ISP Manager

Mobile-first web app for an internet service provider (ISP) reseller business: subscriber management, invoicing/payments, inventory, and field-collector operations. Built from `CLAUDE_CODE_PROMPT.md` (kickoff doc) and `schema_v2.sql` (schema), both in the repo root — read those first for full domain context.

Repo: `github.com/hadi-moustafa/ISP_HZeinaldeen`, branch `main`. Live on Vercel (production Supabase project linked, env vars set).

## Stack

- React 19 + Vite 8 + TypeScript, Tailwind CSS v4 via `@tailwindcss/vite` (not PostCSS)
- Supabase (Postgres + PostgREST) as the entire backend — no custom server. RLS is **intentionally open/off for v1** per the kickoff doc; tightening it is deferred, known future work, not a gap.
- `react-router-dom` v7, nested layout routes with `<Outlet/>`
- Dexie (IndexedDB) for offline caching + a sync queue, for collectors working in the field
- Deno Edge Function (`generate-monthly-invoices`) scheduled via `pg_cron` + `pg_net`
- `xlsx` (SheetJS) for Excel export
- `lucide-react` for icons
- `wa.me` deep links for WhatsApp receipt sharing — no Meta Cloud API, no server-side send

Supabase project ref: `keivdjxabhvdaagrcbtg` (`https://keivdjxabhvdaagrcbtg.supabase.co`).

## Commands


npm run dev      # vite dev server
npm run build     # tsc -b && vite build -- always run before committing
npm run lint      # oxlint
npm run preview
## Architecture

- `src/lib/api/*.ts` — one file per domain (subscribers, invoices, movements, companies, services, collectors, owners, products, reports), each wrapping Supabase queries. Route/page components call these, never `supabase` directly.
- `src/lib/supabase.ts` — client singleton (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- `src/context/StaffContext.tsx` + `src/lib/auth.ts` — current-staff session state
- `src/lib/permissions.ts` — `canAccess()` / `isAdmin()`. v1 deliberately gives collectors full access (`role === 'admin' || true`) per client instruction, but every call site routes through this function so a real permission check can be dropped in later without touching call sites.
- `src/components/ProtectedRoute.tsx` — auth gate, supports `adminOnly`
- `src/lib/offline/db.ts` + `sync.ts` — Dexie schema + sync-queue flush (insertion order), used from `OfflinePage.tsx` (route `/field`)
- `src/pages/ReceiptPage.tsx` — public, unauthenticated route `/receipt/:id`, the link shared via WhatsApp
- `supabase/migrations/` — `0001_init.sql` (schema), `0002_invoicing.sql` (invoicing + `postpone_invoice` RPC), `0003_drop_whatsapp_column.sql` (reverted an earlier `whatsapp_sent_at` column after the WhatsApp pivot below), `0004_subscriber_import.sql` + `0005_import_address_line2.sql` (Excel import — see below)
- `src/lib/api/import.ts` + `src/pages/admin/ImportPage.tsx` (route `/admin/import`) — one-way Excel → Supabase subscriber import, matching the ISP panel's own export format
- `supabase/functions/generate-monthly-invoices/` — Edge Function: creates the month's invoices, skips suspended/cancelled subscribers, idempotent via unique constraint
- `supabase/ops/schedule_invoice_cron.sql` — `pg_cron`/`pg_net` wiring to invoke the Edge Function monthly

## Routes

```
/login
/receipt/:id                    public, unauthenticated
/                                dashboard
/admin/{companies,services,collectors,owners,products}   admin CRUD, all under AdminLayout
/subscribers                    list (SubscribersListPage)
/subscribers/new, /:id, /:id/edit
/reports/monthly-log
/reports/financials             adminOnly
/field                          offline/sync page for collectors
```

## Confirmed product decisions (asked mid-build, now settled)

- **Invoicing is automatic**, monthly, via the Edge Function + cron — not manually triggered per subscriber.
- **Suspended and cancelled subscribers stop generating invoices.**
- **Postponing an invoice touches the subscriber's `expiry_date`** — `postpone_invoice()` RPC does an atomic 3-way update: invoice row + `subscribers.expiry_date` + a postponements audit row.
- **Receipt delivery is a `wa.me` deep link, not the Meta WhatsApp Cloud API.** Flow: collector taps a link on an invoice → `wa.me/<subscriber phone>?text=<receipt link>` opens WhatsApp pre-filled → collector hits send. Zero infrastructure, no access tokens/templates. Implemented in `src/components/subscriber/InvoicesSection.tsx` (`shareViaWhatsApp`). This replaced an earlier plan to use the Cloud API — don't reintroduce that unless explicitly asked again.
- Vercel is already linked and live; env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are confirmed set in the Vercel dashboard.

## Known platform limitations (confirmed live, not assumptions)

- **PostgREST cannot `ilike` a `uuid` column**, even with a `column::text` cast filter (`operator does not exist: uuid ~~* unknown` — tested directly against this project). Any "search by ID" feature must filter client-side after fetch, not push an `ilike` filter to the DB. See `listSubscribers()` in `src/lib/api/subscribers.ts`.
- **`overflow-hidden` on an ancestor clips absolutely-positioned descendants regardless of `z-index`.** Bit us once on the subscriber search-field dropdown (it was nested inside the `overflow-hidden` pill used for rounded corners). Fix pattern: keep the clipping container and the absolutely-positioned popover as siblings under a shared non-clipping `relative` wrapper.
- **This sandbox cannot reach `public.ecr.aws`**, so `npx supabase functions deploy` hangs pulling the edge-runtime image. Same class of issue as any Docker-pull-based deploy here. Workaround used: deploy Edge Function code by pasting it into the Supabase Dashboard's function editor instead. Note the function's routing **slug is immutable after creation** — renaming only changes a display label; if the slug is wrong, delete and recreate rather than trying to rename.
- Playwright's own browser download is also blocked by this sandbox's network. When visual QA is needed, launch against the system's installed Chrome instead: `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })`. Playwright itself is not a shipped dependency — install as a throwaway devDependency for a QA pass and uninstall afterward; don't leave it in `package.json`.
- `gh auth login` and `npx supabase login` need an interactive browser flow this session can't do — ask the user to run those themselves in their own terminal rather than attempting non-interactive workarounds.

## Excel import (`/admin/import`)

One-way, admin-run, periodic import from the ISP panel's own Excel export (`Username, Name, Password, Address, Mobile, Note, Reseller, Expiry, Service, Blocked, Switch, Date Created, Price, Balance, Region, Building, Nationality, Mac Address, Collector`). Never touches invoices/payments — those stay owned by the app's own billing flow once a subscriber exists.

- Dedupe key: `subscribers.external_username` (new unique column). New username → create; existing → update the ISP-sourced fields only.
- `Blocked = 1` is imported as `suspended`, not `cancelled` (assumption flagged in the UI, not hard-coded certainty — ISP "blocked" most likely means temporary cut-off).
- `Price`/`Balance` from the export are always 0 in real data and are **never used for billing** — the service/plan match (`Service` → `services.name`) is what feeds the existing invoice-generation Edge Function; amount owed is never written directly.
- `Address`/`Region`/`Building` map to `subscriber_addresses.line1`/`region`/`line2` respectively (not `city` — the export has no city column).
- `Password`/`Switch`/`Mac Address`/`Nationality` land in `subscribers.import_metadata jsonb` — a judgment call to avoid a schema change for low-value fields (nationality has no natural column; the network metadata isn't billing-relevant).
- Preview step blocks confirmation on: unresolved `Reseller` (must map to an existing company — never auto-created), unresolved `Service` (map to existing or create new with a price), and duplicate usernames within the uploaded file (never silently deduped).
- Commit is a single Postgres RPC (`import_subscribers_batch`, `supabase/migrations/0004_subscriber_import.sql` + `0005_import_address_line2.sql`), matching the `postpone_invoice()` pattern — one transaction, so a mid-import failure never leaves partial data.
- Real bug caught during verification: SheetJS date cells land at local midnight, and `toISOString()` converts to UTC first — in Beirut (UTC+3) this silently rolled every imported expiry date back one day. Fixed by formatting dates with local getters (`formatDateLocal` in `src/lib/api/import.ts`), never `toISOString()`, for any date-only value.
- Also: this project's Supabase migration history wasn't tracking migrations 0001–0003 (they'd been applied manually via the Dashboard during earlier phases, network-restricted `supabase functions deploy` era) — `supabase db push` tried to replay them and failed. Fixed once with `supabase migration repair --status applied 0001 0002 0003`; future `db push` calls should work normally from here.

## Payments, company payments, inventory status, and activity log (added after the chrome redesign)

- **Subscriber expiry is shown as day-only** (e.g. "15", not a full date) on the subscriber detail page — client-specified, since billing is anchored to a day-of-month, not a specific date. Uses `getUTCDate()` on the `DATE`-typed `expiry_date` string, not `getDate()` — same timezone-shift class of bug as the importer's date handling; `getDate()` would be wrong west of UTC.
- **Auto-renewal on full payment**: `sync_invoice_status()` (the existing trigger that recomputes `invoices.status` from `payments`) now also bumps `subscribers.expiry_date` forward one month, anchored to the day-of-month of `connection_date`, the moment an invoice transitions into `'paid'` (not on every payment row change, not reversed if a payment is later deleted). `supabase/migrations/0010_auto_renew_on_paid.sql`. Explicit client decision, not a guess — literal reading of "renew a month from when he was added." Verified live including the Postgres month-arithmetic gotcha this had to route around: `date + interval '1 month'` does NOT clamp to the target month's last day (`'2026-01-31'::date + interval '1 month'` rolls over to March 2nd, not Feb 28th) — the trigger builds the target month via `date_trunc(...)` (always day 1, overflow-safe) and clamps the day back down manually. Confirmed live: an anchor day of 31 landing on a 28-day February correctly produced Feb 28, not a March rollover.
- **Company payments** (`/admin/company-payments`, `src/lib/api/companyPayments.ts`): tracks what the ISP pays each reseller company, distinct from what subscribers pay the ISP. "Total owed" per company comes from the `company_dues` view — sum of `services.paid_price` (what the ISP pays the company per subscriber; distinct from `sell_price`, what the subscriber pays the ISP) across subscribers currently on that company's services. Judgment call: only `active` subscribers count, matching invoice generation's existing suspended/cancelled skip. `supabase/migrations/0009_company_payments.sql`.
- **Inventory payment status** (`product_movements.payment_status`, `'paid' | 'unpaid' | 'partial'`): sale movements can be marked as paid/unpaid/partial and are color-coded in the stock movement history (green/red/orange) in `ProductsPage.tsx`; changeable inline via a select on each sale row, or set at log-movement time. Meaningless for restock/adjustment/return (always `'paid'`). `supabase/migrations/0008_product_payment_status.sql`.
- **Payment status colors are now literal**: green = paid, orange = postponed, red = debt (previously emerald/amber/rose) across `SubscribersListPage.tsx`.
- **Subscriber list advanced filters** extended to phone, national ID, notes (all `ilike`, safe since they're plain text columns — not the uuid-`ilike` limitation above), and a connection-date range, plus a 4th search-field option (`username`, against `external_username`). A "Select all / Clear" toggle sits next to the existing per-card multiselect checkboxes.
- **Excel import header matching hardened**: `parseWorkbookFile()` in `src/lib/api/import.ts` now remaps each parsed row's keys to canonical header names via a trimmed/lowercased lookup, so a real export with slightly different header casing or spacing (not just reordered columns, which already worked) still lands on the right field instead of silently reading blank.
- **Activity log** (`/admin/activity-log`, `src/lib/api/activityLog.ts`, `activity_log` table): a plain-English history of what's happened in the app, covering subscriber CRUD, payments, invoice postponements, Excel imports, company payments, and all reference-data CRUD (companies/services/collectors/owners/products) — explicit client choice of "everything" over a narrower "core billing only" scope. Implemented **application-level, not via DB triggers**: triggers can't identify which staff member performed an action, since this app uses a custom `staff` table (not Supabase Auth) with no session identity available inside Postgres. Every mutating page calls `logActivity()` (fire-and-forget, swallows its own errors so a logging failure never breaks the operation it's describing) right after the real mutation succeeds. Address-level CRUD (subscriber/company address line edits) is deliberately not logged — judgment call to avoid drowning the log in low-value entries; flagged here in case that's wanted later.

## Data model notes

- Subscribers embed `owners`, `default_collector` (aliased FK: `collectors!default_collector_id`), `services` (which embeds `companies`), and `subscriber_addresses` — see `SUBSCRIBER_SELECT` in `src/lib/api/subscribers.ts` for the canonical PostgREST embed shape.
- Debt state isn't a column — it's derived from `invoices.status in ('unpaid','partial')`, fetched separately (`listDebtSubscriberIds`) and merged client-side, because "paid up" (no invoice at all) doesn't map onto an embedded-resource filter.
- Monthly billing status per subscriber (paid/debt/postponed/none) for the list view comes from `listMonthlyLog()` in `src/lib/api/reports.ts` (the same `monthly_log` view Phase 7's reports page uses) — don't reassemble this logic ad hoc elsewhere.
- Client-generated UUIDs (`crypto.randomUUID()`) are used so offline-created records can safely `upsert` on sync retry without duplicating.

## Workflow expectations

- **Always verify backend claims against the live Supabase project** (REST/RPC curl calls or direct queries), not just `npm run build` type-checking. Several real bugs in this project were only caught this way.
- **Always commit with a detailed, explanatory message and push to `origin/main`** after a unit of work completes — this has been explicit and repeated user instruction throughout the build.
- Clean up test data created in Supabase during verification before committing.
- When adapting a design mockup (fake data, decorative-only elements), wire it to real functionality rather than copying the mock verbatim — e.g., a mockup's static checkboxes with no bulk action behind them should be dropped, not shipped inert; a decorative menu icon should become a real menu.

## Build status

All 10 build-order phases from the kickoff doc (Setup → Auth → Reference data → Subscribers → Invoicing/payments → Inventory → Monthly log/financials/Excel export → Offline layer → Mobile polish → Deployment) are complete and live.

The subscriber list (`src/pages/subscribers/SubscribersListPage.tsx`) was redesigned to match a client-provided mockup: pill-shaped controls, a Name/ID/Owner search-field selector, All/Debt/Adv. filter chips, status-colored left-border cards with a live payment-progress bar. All existing filter/export/data functionality was preserved underneath the new visuals.

**App-wide chrome redesign (hamburger nav, light-mode-only, dashboard, subscriber list actions):**
- `src/components/AppHeader.tsx` — shared header used by every layout (`AdminLayout`, `SubscribersLayout`, `ReportsLayout`, `DashboardPage`): hamburger button opens a slide-out drawer with every page link (grouped: main nav, then Reference data/admin section) and Log out at the bottom. Logout was removed from the old per-layout top-right corner and lives only in this drawer now.
- `HeaderActions` (exported from `AppHeader.tsx`) is a small portal: a page rendered inside a layout's `<Outlet/>` can put a button next to the hamburger (e.g. Subscribers' Export button) via `<HeaderActions><button/></HeaderActions>` without prop-drilling through the layout. Context holds the header's action-slot DOM node; `createPortal` renders into it.
- **Light mode is forced app-wide** via `src/index.css`: `@custom-variant dark (&:where(.dark, .dark *));` redefines Tailwind's `dark:` variant from the OS `prefers-color-scheme` media query to a class selector that's never applied, so every existing `dark:` utility class across the codebase is inert without having to strip them file-by-file. Verified live with the browser forced to `prefers-color-scheme: dark` — the app stayed light.
- Dashboard (`DashboardPage.tsx`) replaced its link-grid (now redundant with the hamburger) with: a hand-rolled conic-gradient donut chart (`src/components/DonutChart.tsx`, no charting library) showing collected vs. left-to-collect for the current billing month, a total-subscribers counter, and a collected-this-month counter. Figures are **current month**, matching the `monthly_log` semantics used everywhere else (not all-time totals) — sourced from `getDashboardSummary()` in `src/lib/api/reports.ts`.
- Subscriber list: Add button shrank to an icon-only circular `+`; Export moved into the header via `HeaderActions`; each card gained a top-left checkbox (wired to Export — exports only the selected rows when any are selected, otherwise the current filtered list) and a Pay button (opens the same payment-logging modal pattern as `InvoicesSection`/`OfflinePage`, disabled when the subscriber has no invoice for the current period).
- `monthly_log` view gained a trailing `invoice_id` column (`0006_monthly_log_invoice_id.sql`) so the list's Pay button can log a payment against the correct invoice without a second round-trip per row. Real gotcha hit live: `CREATE OR REPLACE VIEW` only allows *appending* trailing columns — putting `invoice_id` first in the SELECT list failed against the real project; it has to go last.

### Known open item

The kickoff doc's admin "Create Collector" login-provisioning screen (set a `staff` username/password for a new collector, calling `set_staff_password`) was **never built** — only the Collectors business-entity CRUD (name/phone, in `src/pages/admin/CollectorsPage.tsx`) exists. This was flagged to the user in a build-report but not yet confirmed/actioned — check with the user before assuming it's wanted, but don't forget it's outstanding.
