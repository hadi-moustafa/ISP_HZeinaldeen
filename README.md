# ISP Manager

A mobile-first web app for running an internet service reseller business. It covers subscribers, monthly billing and payments, inventory, technician tasks, and field collectors who collect cash door to door and send receipts over WhatsApp.

## Features

- **Subscribers**: search, filters and sorting by address, building, expiry and more. Bulk actions, and export to Excel.
- **Billing**: invoices are generated automatically every night. Each subscriber is billed on their own billing day. Unpaid balances carry over to the next month, and a payment renews the subscription.
- **Payments**: mark a bill paid, postponed or as debt, or forgive it. A hold-to-pay shortcut is available on the subscriber list. Receipts and notices go out in Arabic through WhatsApp deep links.
- **Excel import**: one-way import from the ISP panel's own export, with column mapping, a preview step and a single-transaction commit.
- **Inventory**: products, stock movements and paid/unpaid sales.
- **Tasks**: admins assign work orders to technicians, who have their own task-only accounts and can request products for a job.
- **Finance and activity**: dashboard, monthly log, financial report, what the business owes each company, collection feedback and a full activity log.
- **Offline mode**: collectors can work without a connection and sync later.
- **Two designs**: Classic and New, switchable per device.

## Stack

- React 19, Vite, TypeScript, Tailwind CSS v4, React Router 7
- Supabase (Postgres + PostgREST) as the whole backend, with no custom server
- Dexie (IndexedDB) for offline caching and the sync queue
- `pg_cron` for nightly billing
- SheetJS for Excel import and export, and `lucide-react` for icons

## Project layout

```
src/
  lib/api/        one module per domain; pages call these, never Supabase directly
  lib/offline/    Dexie schema and sync queue
  pages/          route components (admin/, subscribers/, reports/, ...)
  components/     shared UI
  styles/         the switchable "New" design
supabase/
  migrations/     schema, RPCs and triggers (billing logic lives here)
  functions/      Edge Functions
  ops/            cron wiring
```

Billing rules that have to be atomic (payments, postponing, carry-over, renewal, import) are Postgres functions and triggers, not frontend code. All dates use Beirut time.

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Supabase URL and anon key
npm run dev
```

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the Vite dev server                 |
| `npm run build`   | Type-check and build (run before commits) |
| `npm run lint`    | Lint with oxlint                          |
| `npm run preview` | Serve the production build locally        |

Apply the database schema with `npx supabase db push` against your own Supabase project.

## Deployment

The app is a static SPA deployed on Vercel. `vercel.json` rewrites every path to `index.html` so client-side routes work on reload. Don't remove it. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the hosting environment.

## Further reading

`CLAUDE.md` is the detailed design log. It records each product decision, known gotcha and the reasoning behind each migration.
