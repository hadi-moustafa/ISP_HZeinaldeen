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

```
npm run dev      # vite dev server
npm run build     # tsc -b && vite build -- always run before committing
npm run lint      # oxlint
npm run preview
```

## Architecture

- `src/lib/api/*.ts` — one file per domain (subscribers, invoices, movements, companies, services, collectors, owners, products, reports), each wrapping Supabase queries. Route/page components call these, never `supabase` directly.
- `src/lib/supabase.ts` — client singleton (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- `src/context/StaffContext.tsx` + `src/lib/auth.ts` — current-staff session state
- `src/lib/permissions.ts` — `canAccess()` / `isAdmin()`. v1 deliberately gives collectors full access (`role === 'admin' || true`) per client instruction, but every call site routes through this function so a real permission check can be dropped in later without touching call sites.
- `src/components/ProtectedRoute.tsx` — auth gate, supports `adminOnly`
- `src/lib/offline/db.ts` + `sync.ts` — Dexie schema + sync-queue flush (insertion order), used from `OfflinePage.tsx` (route `/field`)
- `src/pages/ReceiptPage.tsx` — public, unauthenticated route `/receipt/:id`, the link shared via WhatsApp
- `supabase/migrations/` — `0001_init.sql` (schema), `0002_invoicing.sql` (invoicing + `postpone_invoice` RPC), `0003_drop_whatsapp_column.sql` (reverted an earlier `whatsapp_sent_at` column after the WhatsApp pivot below)
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

### Known open item

The kickoff doc's admin "Create Collector" login-provisioning screen (set a `staff` username/password for a new collector, calling `set_staff_password`) was **never built** — only the Collectors business-entity CRUD (name/phone, in `src/pages/admin/CollectorsPage.tsx`) exists. This was flagged to the user in a build-report but not yet confirmed/actioned — check with the user before assuming it's wanted, but don't forget it's outstanding.
