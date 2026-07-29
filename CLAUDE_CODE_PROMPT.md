# Prompt for Claude Code — ISP Management App, Project Kickoff

Paste this whole document as your first message to Claude Code in the project's
repo root. Keep `schema_v2.sql` in the repo root alongside it — treat that file
as the living source of truth for the database and update it (never silently
diverge from it) whenever a migration changes the schema.

---

## Project

Build a mobile-first web app for an internet service provider (ISP) reseller
business to manage subscribers, payments, inventory, and reporting. This is a
commissioned project with a client who will iterate on requirements — build in
phases, confirm assumptions where marked below, and keep the codebase easy to
extend.

## Tech stack (fixed, do not deviate without asking)

- **Frontend:** React + Vite, TypeScript
- **Styling:** Tailwind CSS, mobile-first (design for ~375px width first)
- **Backend/DB:** Supabase (Postgres). Schema lives in `schema_v2.sql` in repo root.
- **Hosting:** Vercel
- **Excel export:** SheetJS (`xlsx` package), generated client-side from already-loaded data
- **Offline support:** see dedicated section below

## Core features to build

1. **Companies** — the network operators the ISP resells services from. CRUD
   pages. Each company can have multiple addresses (`company_addresses` table
   — dynamic, not a single fixed address field).
2. **Services** — plans, each tied to one company, with `sell_price` (what the
   subscriber pays) and `paid_price` (what the ISP pays the company). CRUD pages.
3. **Products / Inventory** — a stock/inventory manager: product list with
   SKU, category, cost price, sell price, quantity in stock, reorder level.
   Every stock change (restock, sale, adjustment, return) is a row in
   `product_movements` — never edit `quantity_in_stock` directly in the UI,
   always create a movement record and let the DB trigger update the cached total.
4. **Subscribers** — the ISP's customers. Each has:
   - Multiple dynamic addresses (`subscriber_addresses`)
   - An **owner** (whose customer this is — one owner can have many subscribers)
   - A **default collector** (who *usually* collects their payment)
   - A service, connection status, expiry date, and other attributes
   - A **very detailed filtering system** on the subscriber list: filter by
     owner, default collector, service, company (via service), connection
     status, debt/unpaid status, expiry date range, and free-text search on
     name/phone (the schema includes a trigram index on name for fast partial
     search — use `ILIKE` or `%` search against it).
5. **Payments** — cash collected in person, logged (not processed) in the app.
   Key nuance: the collector who actually collects a given month's payment can
   differ from the subscriber's default collector — `payments.collector_id`
   records the *actual* collector for that instance; `subscribers.default_collector_id`
   is just the usual one. Never conflate these.
6. **Debt / postponement** — each subscriber's monthly charge is an `invoices`
   row (one per subscriber per month). Status moves through
   unpaid → partial → paid automatically via a DB trigger as payments come in.
   Postponing a due date updates `invoices.postponed_to` AND writes a row to
   `postponements` for the audit trail — always do both, never just one.
7. **Monthly log page** — for a selected month, show: each subscriber's amount
   due/paid/status, who hasn't paid, who's in debt, total collected (services)
   and total sold (products). The `monthly_log` and `monthly_financials` views
   in the schema are built for exactly this — query them rather than
   reassembling the logic in the frontend.
8. **General financial page** — admin-only. Aggregate view combining service
   revenue and product revenue (use `monthly_financials`). Gate this route at
   both the frontend (hide nav) and any Supabase query level — don't rely on
   frontend hiding alone once RLS is tightened later.
9. **Excel export** — every major list/report page (subscribers, monthly log,
   financials, products) needs an "Export to Excel" button using SheetJS,
   exporting exactly what's currently filtered/visible on screen.
10. **Mobile-first UI** — this is primarily used on phones in the field. Every
    screen must work well at ~375px: card-based lists instead of dense tables,
    large tap targets, minimal typing where possible (pickers/dropdowns over
    free text for things like collector/owner/service selection).

## Authentication (simple by design, expand later)

- No Supabase Auth users. A custom `staff` table holds hardcoded-style
  username/password logins for two roles: `admin` and `collector`.
- Passwords are hashed with `pgcrypto`'s `crypt()` — never store or transmit
  plaintext. Use the provided `login_staff(username, password)` Postgres
  function (called via Supabase RPC) to verify login; it returns the staff
  record (no hash) on success and nothing on failure.
- **Admin** has an "Create Collector" page: sets a username + password for a
  new collector account (calls `set_staff_password` after inserting into
  `staff`), and can reset/change any collector's username or password at any
  time from the same area.
- **Access control for v1:** admin has access to everything. Collector access
  should be **functionally unrestricted for now** (per client instruction —
  "keep it open, we'll restrict later") but architect the app so that
  restricting it later is a config change, not a rewrite:
  - Keep a single `currentStaff` context (role, collector_id) available
    app-wide from login.
  - Route/permission checks should already be structured as
    `if (currentStaff.role === 'admin' || <permission check>)` even if the
    permission check currently always returns true — so tightening later
    means changing that one condition, not adding new plumbing.
  - The financial page is the one exception: gate it to `role === 'admin'` now.
- RLS is intentionally OFF/open in the schema for v1. When the client asks to
  restrict collectors, the recommended path (don't build this yet, just know
  it's coming) is: mint a JWT with custom claims (`staff_id`, `role`,
  `collector_id`) after a successful `login_staff` call, set it as the
  Supabase client session, and write RLS policies that read `auth.jwt()`.

## Offline support

The app must remain usable with limited functionality while offline (e.g. a
collector in a low-signal area logging a cash payment), then sync once back
online.

- Because all primary keys are UUIDs generated with `gen_random_uuid()`,
  records can be created fully offline with their final ID — syncing later is
  just an upsert, no ID-remapping needed.
- Recommended approach: a local IndexedDB store (via `Dexie.js` or similar) that
  mirrors the subset of data needed for offline use (assigned subscribers,
  their invoices, recent payments). Writes made offline (mainly: logging a
  payment) are saved locally immediately and queued; a listener on
  `window.online`/`navigator.onLine` flushes the queue to Supabase in order
  when connectivity returns, using upsert-by-id so a retried sync is safe.
- Scope offline support to what's actually needed in the field: viewing
  assigned subscribers and logging payments/postponements. Admin-only screens
  (financials, inventory management, company/service CRUD) do not need to
  work offline — assume the admin is generally connected.
- Build a lightweight service worker + PWA manifest so the app can be added to
  the home screen and cache static assets, on top of the IndexedDB data layer.

## Build order (phases — do not skip ahead)

1. **Setup:** Vite+React+TS scaffold, Tailwind, Supabase project, apply
   `schema_v2.sql` as the first migration, Vercel project linked with preview deploys.
2. **Auth:** staff table, login page, `currentStaff` context, protected routing.
3. **Reference data (admin):** companies + addresses, services, collectors,
   owners, products CRUD.
4. **Subscribers:** list with the full filter system, detail view, create/edit,
   addresses.
5. **Invoicing + payments:** monthly invoice generation (a scheduled Supabase
   function or manual "generate this month's invoices" admin action — confirm
   with client which they'd prefer), payment logging flow (fast, mobile,
   collector-facing), postponement flow.
6. **Inventory:** product CRUD, movement logging (restock/sale/adjustment),
   stock levels reflected live.
7. **Monthly log + financial pages:** built on the provided views, with
   Excel export.
8. **Offline layer:** IndexedDB caching + sync queue for the subscriber/payment
   flows collectors actually use in the field.
9. **Mobile polish pass:** every screen re-checked at 375px and 768px.
10. **Deployment:** production Supabase project, environment variables in
    Vercel, final walkthrough.

## Open questions to confirm with the client before Phase 5

- How are monthly invoices generated — automatically on the 1st of each
  month, or manually triggered by the admin? (Schema supports either; app
  logic differs.)
- When a subscriber's connection status is `suspended` or `cancelled`, should
  new invoices stop generating for them automatically?
- Should postponing an invoice change `expiry_date`/service access at all, or
  purely a billing-side record?

## Conventions

- Every new table: UUID PK via `gen_random_uuid()`, `created_at`, and
  `updated_at` (with the `set_updated_at` trigger) unless there's a specific
  reason not to.
- Money: always `DECIMAL(10,2)`, never float.
- Status/enum-like fields: `TEXT` + `CHECK` constraint, not booleans or magic
  integers.
- Any schema change: write a new file in `/supabase/migrations`, then update
  `schema_v2.sql` to match — they must never drift apart.
- State clearly at the start of any response which phase/task you're working on.
