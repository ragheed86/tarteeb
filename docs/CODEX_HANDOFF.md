# CODEX_HANDOFF.md — Tarteeb SaaS App

> Handoff from Claude Code → Codex. Generated 2026-07-01.
> **No secrets are included in this document.** Environment variable *names* are listed; values live only in `.env.local` (git-ignored) and in the Vercel project settings.

---

## 1. Project Overview

**What it is:** "ترتيب" (Tarteeb) — a business-management SaaS (ERP/CRM) for a home/space-organizing company operating in Riyadh, Saudi Arabia. Fully Arabic, right-to-left (RTL) interface.

**Main business goal:** Give the company one place to manage clients, projects (space-organizing jobs), project costs & profitability, inventory/warehouse, employees and their documents, suppliers, partner accounts, government/license accounts, and ZATCA-style tax invoices — with a live dashboard.

**Main users / roles:** Company owner + internal staff (managers/accountants). Auth today is a **single shared authenticated tier** — every logged-in user has full access. There is **no per-role restriction yet** (see Known Bugs).

**Current stack & architecture:**
- **Next.js 14** (App Router), **JavaScript (not TypeScript)**, React 18.
- **Plain CSS**, single global stylesheet `src/app/globals.css` (no Tailwind, no CSS modules).
- **Supabase** (`@supabase/supabase-js`) — Postgres + Auth + RLS. Project ref: `yvxequegdyrhjghprnya`.
- **Client-side data fetching only.** Every page is `'use client'`, fetches in `useEffect`, and calls a centralized data layer (`src/lib/data.js`). There are **no API routes, no server actions, no server components** doing data work.
- **Auth gate is client-side** in `src/app/AppShell.jsx` (Supabase `signInWithPassword`). There is **no `middleware.js`** — routes are not server-protected.
- **Deployment:** Vercel (project `tarteeb-six`, live at https://tarteeb-six.vercel.app). Auto-deploy from GitHub is **not reliably wired** — last deploy was done manually via Vercel CLI.

---

## 2. Current State

### Implemented & working (verified via `next build` + live DB round-trips)
All 12 planned sections are built. Pages return HTTP 200 in dev and production:

| Module | Route(s) | Status |
|---|---|---|
| Dashboard | `/` | ✅ Working — real KPIs + alert cards |
| Clients (CRM) | `/clients`, `/clients/[id]` | ✅ CRUD + search + 360 profile |
| Projects | `/projects`, `/projects/[id]` | ✅ CRUD + tasks/team/media/costs |
| Warehouse | `/warehouse` | ✅ CRUD + filters + low-stock alert |
| Employees | `/employees` | ✅ CRUD + documents modal + expiry alerts |
| Suppliers | `/suppliers` | ✅ CRUD |
| Partners | `/partners` | ✅ CRUD + transactions + computed balance |
| Government accounts | `/government` | ✅ CRUD + expiry alerts (no plaintext passwords) |
| Invoices | `/invoices`, `/invoices/[id]` | ✅ Create w/ line items + VAT + printable sheet |
| Settings | `/settings` | ✅ Edit single company_settings row |

- **CRUD is fully wired to Supabase** through `src/lib/data.js` (66 exported functions).
- **Project profitability** is read from a Postgres **view** `project_financials` (never computed/stored client-side).
- **Invoice VAT math** (15%) is computed client-side and stored on the invoice row.
- A full live chain was tested successfully: client → project → project_costs → invoice + invoice_items → `project_financials` view (sale 10000 / cost 4500 / profit 5500 / margin 55%), then cleaned up.

### Partially implemented
- **Media & document uploads** — `project_media.file_url`, `employee_documents.file_url`, `suppliers.logo_url`, `employees.photo_url` accept a **pasted URL string**. There is **no Supabase Storage upload** UI/bucket integration.
- **ZATCA QR** on the invoice detail page is a **visual placeholder only** (`src/app/invoices/[id]/page.js` ~line 124–133). No TLV/Base64 QR is generated. `invoices.zatca_qr` / `zatca_uuid` columns exist but are unused by the app.
- **Top-bar global search** (`src/app/AppShell.jsx` ~line 96) is a decorative input — **not wired** to any search.

### Broken / risky
- **No server-side auth.** Auth is only the client gate in `AppShell.jsx`. Anyone can request a route; only the Supabase RLS (`authenticated`) protects *data*. Direct page HTML is not protected.
- **No role separation.** RLS policy is `for all to authenticated using (true)` on every table — any logged-in user can read/write everything, including `government_accounts`.
- **`src/lib/supabase.js` falls back to placeholder URL/key** when env vars are missing (lines 14–17). This prevents build crashes but means a misconfigured deploy will *silently* point at a non-existent Supabase and every query will fail at runtime instead of failing fast.
- **Delete cascades are aggressive.** Deleting a client cascades to their projects and invoices (FK `on delete cascade`). The UI warns, but there is no soft-delete/undo.

---

## 3. Repository Map

```
tarteeb 3/
├─ CODEX_HANDOFF.md          ← this file
├─ README.md                 setup notes (Supabase + Vercel)
├─ package.json              scripts + deps (JS, no test deps)
├─ next.config.js            reactStrictMode + eslint.ignoreDuringBuilds:true
├─ jsconfig.json             path alias "@/*" -> "./src/*"
├─ .env.local               (git-ignored — secrets, DO NOT COMMIT/READ into code)
├─ .env.local.example        variable NAMES only
├─ prototype/
│  └─ tarteeb-app.html       visual/design reference (mock data — ignore its data)
├─ supabase/
│  └─ migrations/
│     └─ 0001_init.sql       ← FULL schema: 19 tables + 1 view + enums + RLS + seed
└─ src/
   ├─ lib/
   │  ├─ supabase.js         Supabase browser client (reads env, has placeholder fallback)
   │  ├─ data.js             ← ALL data access (CRUD). Single source of truth for queries.
   │  └─ format.js           fmtNum/fmtMoney/fmtDate + status→label/color maps
   └─ app/
      ├─ layout.js           root layout (RTL, fonts) — NOTE: no ToastProvider on this branch
      ├─ globals.css         ← ENTIRE design system (purple glass theme, all classes)
      ├─ AppShell.jsx        sidebar + topbar + client-side auth gate + Login form
      ├─ ui.jsx              shared state components: <Loading/> <Empty/> <ErrorBar/>
      ├─ page.js             Dashboard
      ├─ clients/page.js , clients/[id]/page.js
      ├─ projects/page.js , projects/[id]/page.js   (largest file: tasks/team/media/costs)
      ├─ warehouse/page.js
      ├─ employees/page.js   (+ inline DocsModal component)
      ├─ suppliers/page.js
      ├─ partners/page.js
      ├─ government/page.js
      ├─ invoices/page.js , invoices/[id]/page.js   (printable invoice + print CSS)
      └─ settings/page.js
```

**Where the main logic lives:**
- **All DB reads/writes:** `src/lib/data.js`. Rule for this codebase: *pages must not call `supabase` directly* — extend `data.js`.
- **Formatting & status maps:** `src/lib/format.js`.
- **UI components:** there is **no `src/components/` folder** on this branch. Shared primitives are `src/app/ui.jsx`; everything else is inline per page + CSS classes in `globals.css`.
- **DB logic/migrations:** `supabase/migrations/0001_init.sql` (single migration). Applied manually in Supabase SQL Editor — **there is no CLI migration pipeline in the repo.**
- **API/server actions:** none — all client-side.

---

## 4. Database / Supabase

**Project ref:** `yvxequegdyrhjghprnya` (schema `public`). All PKs are `uuid`; `created_at`/`updated_at` are `timestamptz` with an `updated_at` trigger.

### Tables (19)
`company_settings`, `clients`, `employees`, `employee_documents`, `warehouses`, `categories`, `suppliers`, `inventory_items`, `projects`, `project_team`, `project_tasks`, `project_costs`, `project_media`, `invoices`, `invoice_items`, `partners`, `partner_transactions`, `communications`, `government_accounts`.

### View (1)
`project_financials` — `project_id, sale_price, total_cost, net_profit, margin_pct`. Computed from `projects.sale_price` minus `sum(project_costs.amount)`. **Read-only; always source profit/margin from here, never compute in JS.**

### Important relationships
- `projects.client_id → clients.id` (cascade delete)
- `projects.supervisor_id → employees.id` (set null)
- `project_team` = composite PK `(project_id, employee_id)`, both cascade
- `project_tasks / project_costs / project_media . project_id → projects.id` (cascade)
- `invoices.client_id → clients.id` (set null), `invoices.project_id → projects.id` (set null)
- `invoice_items.invoice_id → invoices.id` (cascade)
- `partner_transactions.partner_id → partners.id` (cascade)
- `employee_documents.employee_id → employees.id` (cascade)
- `inventory_items.category_id / supplier_id / warehouse_id` (set null)
- `communications.client_id → clients.id` (cascade)

### Enums (stored English, displayed Arabic via `format.js`)
`client_source`, `client_status`, `wage_type`, `employee_status`, `doc_type`, `project_status`, `cost_kind`, `media_kind`, `invoice_status`, `partner_txn_type`, `comm_channel`, `comm_direction`, `gov_status`. **Do not send Arabic labels to the DB — send enum values.**

### RLS
Enabled on all 19 tables with a single policy `authenticated_all`: `for all to authenticated using (true) with check (true)`. **No anon access. No role separation.**

### Seed / demo data
The migration seeds: 1 `company_settings` row, 3 `warehouses` (دلال/رغيد/الرياض), 3 `categories` (تخزين/منظمات/أدوات), 3 `partners` (راغد 50 / سلطان 30 / نواف 20). Business tables (clients/projects/invoices) start empty.

### Missing / suspicious schema areas
- `invoices.zatca_qr` (text) and `invoices.zatca_uuid` (uuid, defaulted) exist but the app never populates/uses `zatca_qr`.
- `communications` table is fully readable (`getCommunications`) and creatable (`createCommunication`) in `data.js`, but **no UI creates communications** — the client 360 timeline is read-only.
- `government_accounts.secret_ref` is intended to be a *pointer* to a secret in a Vault, **not** a password. Keep it that way.
- The DB is the authority; **do not run schema-altering migrations without confirming** — the schema was applied manually, so the repo's `0001_init.sql` should match production but may drift.

---

## 5. Business Logic

### How entities connect
- A **client** is the root of the CRM. A client has many **projects**, and many **invoices**.
- A **project** belongs to one client, optionally has a **supervisor** (employee), a **team** (many employees via `project_team`), a checklist of **tasks**, before/after **media**, and **cost** line items.
- **Profitability** of a project = `project_financials` view (see below).
- An **invoice** belongs to a client and optionally a project; it has **invoice_items** (description/qty/unit_price). VAT and totals are stored on the invoice.
- **Partners** hold share percentages and a ledger of **partner_transactions**; each partner's balance is computed client-side from the ledger.
- **Warehouse/inventory** links items to categories, suppliers, and warehouses.
- **Employees** have **documents** with expiry dates driving alerts.
- **Government accounts** track licenses/expiry; secrets are referenced, not stored.
- **Dashboard** aggregates across clients, projects, invoices, and inventory.

> Note: The handoff request mentions "quotations", "purchases", "advances", and "calendar". These exist **only conceptually / in the prototype HTML** — there are **no** quotations, purchases, employee-advances, or calendar tables/pages in this codebase. Projects with `status='quote'` are the closest thing to quotations today.

### Calculations currently used
- **Project financials** (`project_financials` view):
  - `total_cost = COALESCE(SUM(project_costs.amount), 0)`
  - `net_profit = sale_price - total_cost`
  - `margin_pct = round(net_profit / sale_price * 100)` (0 if `sale_price = 0`)
- **Invoice math** (`src/app/invoices/page.js`):
  - `subtotal = Σ(qty × unit_price)`
  - `vat_amount = vat_applicable ? subtotal × 0.15 : 0`  (`VAT_RATE = 15`)
  - `total = subtotal + vat_amount`
- **Client 360 financials** (`src/app/clients/[id]/page.js`):
  - `invoiced = Σ invoice.total`; `paid = Σ total where status='paid'`; `outstanding = invoiced − paid`.
- **Partner balance** (`src/app/partners/page.js`):
  - sign map: `profit_share/deposit/carryover = +1`, `withdrawal = −1`; `balance = Σ(sign × amount)`.
- **Dashboard** (`src/app/page.js`):
  - `revenue = Σ invoice.total where status='paid'`
  - `outstanding = Σ invoice.total where status ∉ {paid, draft}`
  - `activeProjects = count(status ∈ {quote, preparing, in_progress})`
  - `newClients = count(created_at within 30 days)`
  - `lowStock = items where quantity < reorder_level`
  - `upcoming deliveries = open projects with due_date within 14 days`

---

## 6. UI / UX Rules

### RTL / Arabic
- `html lang="ar" dir="rtl"` set in `src/app/layout.js`. All copy is Arabic.
- **Numbers must always render Latin (0–9)** via `fmtNum`/`fmtMoney` (`Intl.NumberFormat('en-US')`). Dates use `Intl.DateTimeFormat('ar-SA-u-nu-latn', …)` (Latin digits). Numeric cells use class `amt` (tabular-nums) with `dir="ltr"` where appropriate.
- **Currency is shown as text ` ر.س`**, NOT the `﷼` symbol. (The original build spec asked for `﷼`; the codebase intentionally uses `ر.س` for consistency — pick one and apply app-wide if changing.)

### Brand / design
- Design tokens in `:root` of `globals.css`. Purple "glass" theme: `--pine #5B3DC4`, `--green #6C4DE0`, `--sage #A78BF0`, accent `--gold #F0913E`; surfaces use `backdrop-filter: blur`. Fonts: **Readex Pro** (display) + **IBM Plex Sans Arabic** (body), loaded via Google Fonts in `layout.js`.
- Reusable classes: `.card`, `.btn`/`.btn.ghost`/`.btn.sm`, `.pill` + `.p-prog/.p-done/.p-wait/.p-quote/.p-cancel`, `.form-grid`/`.field`/`.span-2`, `.modal-backdrop`/`.modal-card`(+`.modal-sm`), `.kpis`/`.kpi`, `.pgrid`/`.pcard`, `.inline-add`, `.chips`, `.checklist`, `.timeline`, `.kv`, `.totals`, `.invoice-sheet`. **Reuse these; do not introduce a second styling system.**

### Sidebar / menu behavior
- `AppShell.jsx` renders a fixed RTL sidebar (grouped nav: العمليات / المالية / المؤسسة), a topbar with page title + decorative search, and a logout button. On ≤860px the sidebar becomes a slide-in drawer toggled by a hamburger, with a scrim; it auto-closes on navigation.

### Known UI issues
- Topbar search input is non-functional.
- No toast/notification system on this branch (feedback is inline `errbar`/`okbar` + `alert()`/`confirm()` for deletes).
- Active-nav highlight only matches exact paths, so detail routes (`/clients/[id]`, `/projects/[id]`, `/invoices/[id]`) show no active menu item.

### Mobile / responsive
- Grids collapse via `@media(max-width:1100px)` and `@media(max-width:640px)` in `globals.css`. Tables are wide and rely on horizontal scroll on small screens (no dedicated mobile card view for tables).

---

## 7. Known Bugs / Pending Requests (prioritized)

**CRITICAL**
1. **No route-level / server-side auth + no role separation.** All authenticated users can read/write every table, including `government_accounts`. Files: `src/app/AppShell.jsx` (add real guard / add `middleware.js`), `supabase/migrations/*` (add role-based RLS). Business impact: sensitive gov/partner/financial data exposed to any logged-in user.

**HIGH**
2. **ZATCA QR not generated.** Invoices are not ZATCA-compliant. Files: `src/app/invoices/[id]/page.js` (~124–133), needs a server route/edge function to produce TLV Base64 into `invoices.zatca_qr`.
3. **File uploads are URL-only.** No Supabase Storage buckets/upload. Files: `projects/[id]/page.js` (MediaCard), `employees/page.js` (DocsModal), plus `suppliers`/`employees` logo/photo fields.

**MEDIUM**
4. **Silent Supabase misconfig fallback.** `src/lib/supabase.js` uses placeholder URL/key when env missing → runtime query failures instead of a clear startup error.
5. **Non-functional global search** in `AppShell.jsx` topbar.
6. **No active-nav state on detail pages** (`AppShell.jsx`).
7. **Currency symbol inconsistency** (`ر.س` vs spec's `﷼`) — decide and standardize in `format.js`/pages.
8. **Communications are read-only** — `createCommunication` exists in `data.js` but no UI logs interactions on the client 360.

**LOW**
9. **`backup-my-work` local branch** holds an abandoned alternative component system (from an earlier divergence). Not pushed. Safe to delete once confirmed unneeded.
10. **Delete confirmations use native `confirm()`/`alert()`** — replace with in-app modal/toast for polish.
11. **Prototype file** `prototype/tarteeb-app.html` contains mock data; keep as visual reference only.

---

## 8. Testing Status

- **No automated tests.** No Playwright/Jest/Vitest config, no `tests/` or `e2e/` directory, and no test dependencies in `package.json`. `npm run lint` exists but ESLint is set to `ignoreDuringBuilds` in `next.config.js`.
- **What HAS been verified:**
  - `npm run build` compiles all 14 routes with no errors.
  - Dev server: all route patterns return HTTP 200 (auth-gated pages render the login shell for unauthenticated requests, which is expected).
  - Live Supabase round-trips executed manually (via MCP SQL) for the client CRUD path and the full client→project→cost→invoice→`project_financials` chain, then cleaned up. No leftover rows.
- **What still needs testing:**
  - End-to-end UI CRUD **while logged in** (create/edit/delete through the actual forms) for every module — only build/HTTP-status and DB-level inserts were verified, not the in-browser form flows.
  - Invoice creation happy-path + validation (empty items, VAT toggle) through the UI.
  - Partner balance signs and dashboard aggregates against real data.
  - RTL/responsive rendering on mobile widths.
- **Dead buttons / risky flows to check first:**
  - Topbar search (dead).
  - ZATCA QR (placeholder).
  - Detail-page links from client 360 to `/projects/[id]` and `/invoices/[id]` (should work now that those routes exist — re-verify).
  - Media/document "add" flows expect a valid image/file URL; a bad URL renders a broken image.

Recommended: add **Playwright** with an authenticated storage-state fixture (login once, reuse session) and smoke-test each route + one CRUD per module.

---

## 9. Deployment

- **GitHub:** `github.com/ragheed86/tarteeb`, branch **`main`**. Working tree is **clean**; local `main` == `origin/main` at commit `8e33151`. A second local branch `backup-my-work` exists (not pushed).
- **Vercel:** Project **`tarteeb-six`** under team scope **`tarteeb`**, live at **https://tarteeb-six.vercel.app** (all sections return 200 as of last deploy). **Auto-deploy from GitHub is NOT reliably wired** — the last production deploy was done manually with the Vercel CLI, and the primary domain alias had to be reassigned by hand. Treat pushes as **not** auto-deploying until the Git integration is confirmed in Vercel → Settings → Git.
- **Environment variables needed** (names only; set in `.env.local` locally and in Vercel project settings):
  - `NEXT_PUBLIC_SUPABASE_URL` (build-time, public)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build-time, public)
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only; **must never be exposed to the browser** — not currently used by any client code, keep it out of `NEXT_PUBLIC_*`)
- **Build command:** `next build` (`npm run build`). Start: `next start`. Dev: `next dev` (defaults to port 3000).
- **Deployment risks:**
  - `NEXT_PUBLIC_*` are inlined at **build time** — changing Supabase project requires a **rebuild**, not just an env edit.
  - Placeholder fallback in `supabase.js` masks missing env at build time (build succeeds but runtime queries fail).
  - Manual-deploy dependency: forgetting the alias step leaves the domain on an old build.

---

## 10. Next Recommended Tasks for Codex

> Follow this codebase's conventions: JavaScript (no TS), all queries via `src/lib/data.js`, UI via `ui.jsx` + `globals.css` classes, enums stored English/displayed Arabic, Latin numerals. **Do not alter the DB schema without explicit confirmation.**

1. **Add server-side auth + role-based access (CRITICAL, #1).**
   - Inspect/change: add `src/middleware.js` (protect all routes except login assets), `src/app/AppShell.jsx` (keep client gate), and a new migration for role-aware RLS (e.g., a `profiles.role` column + policies restricting `government_accounts`, `partners`, `partner_transactions`).
   - Acceptance: unauthenticated requests to any app route redirect to login server-side; a non-owner role cannot read `government_accounts`/partner data via the API; existing owner flows unaffected; `npm run build` passes.

2. **Fail-fast Supabase config (MEDIUM, #4).**
   - Inspect/change: `src/lib/supabase.js`.
   - Acceptance: when `NEXT_PUBLIC_SUPABASE_*` are missing, the app shows a clear configuration error screen instead of silently querying a placeholder host; build still succeeds.

3. **Add a Playwright smoke + CRUD test suite (Testing, #8).**
   - Inspect/change: add `playwright.config.*`, a `tests/` dir, an authenticated storage-state fixture; add `test` script to `package.json`.
   - Acceptance: `npm run test` logs in once, visits all 10 sections (200 + key heading visible), and performs one create+delete for clients and one invoice create; suite green locally.

4. **Implement Supabase Storage uploads (HIGH, #3).**
   - Inspect/change: `src/lib/data.js` (add upload helpers), `src/app/projects/[id]/page.js` (MediaCard), `src/app/employees/page.js` (DocsModal); create a Storage bucket + policies.
   - Acceptance: user can upload an image/file that is stored in Supabase Storage and its path saved to `file_url`; existing URL-paste path still works; RLS restricts bucket to authenticated users.

5. **Generate ZATCA-compliant invoice QR (HIGH, #2).**
   - Inspect/change: add a server route or Supabase Edge Function that builds the ZATCA TLV Base64 and writes `invoices.zatca_qr`; render it in `src/app/invoices/[id]/page.js` (replace the placeholder ~line 124–133).
   - Acceptance: a created invoice has a scannable QR encoding seller name, VAT number, timestamp, total, and VAT amount; print layout still works; no secrets in client bundle.

---

## 11. First Prompt for Codex

> Paste this into Codex to continue safely.

```
You are taking over the "Tarteeb SaaS App" (Next.js 14 App Router, JavaScript — NOT TypeScript, plain CSS, Supabase). Read CODEX_HANDOFF.md in the project root FIRST — it is the source of truth for architecture, schema, conventions, and known issues.

Hard rules:
- JavaScript only. Do not convert to TypeScript.
- ALL database reads/writes go through src/lib/data.js. Never call the `supabase` client directly from a page/component. Extend data.js with the five-function CRUD pattern already used there.
- UI: reuse src/app/ui.jsx primitives (<Loading/>, <Empty/>, <ErrorBar/>) and the existing CSS classes in src/app/globals.css (.card, .btn, .pill .p-*, .form-grid/.field, .modal-backdrop/.modal-card, .kpis/.kpi, .pgrid/.pcard). Do not add Tailwind or a second styling system, and do not create a src/components/ folder.
- Arabic RTL throughout. Numbers must be Latin via fmtNum/fmtMoney; dates via fmtDate (src/lib/format.js). Enums are stored in English and displayed via the Arabic label maps in format.js — never send Arabic labels to the DB. Currency renders as " ر.س" text.
- Do NOT change the Supabase schema in supabase/migrations/0001_init.sql without explicitly proposing a new migration and getting confirmation. The DB is applied manually; treat it as production. Sensitive columns: government_accounts.secret_ref stores a Vault pointer, never a password.
- Never print, commit, or hardcode secrets. Env var NAMES only: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server-only). .env.local and .env* are git-ignored — keep it that way.
- Profit/margin come from the project_financials Postgres view, not client math. Invoice VAT is 15% (see src/app/invoices/page.js).

Verification workflow for every change:
1. Run `npm run build` and ensure all routes compile.
2. Run `npm run dev` and confirm affected routes return 200.
3. Commit with a Conventional Commit message. Do NOT push or deploy unless asked (Vercel auto-deploy is not reliably wired; deploys are manual).

Start with Task 1 from CODEX_HANDOFF.md section 10 (server-side auth + role-based RLS). Before writing code, show me: (a) the files you will touch, (b) the exact RLS/migration change you propose, and (c) how you will verify it. Wait for my approval on the migration before applying anything to the database.
```

---

*End of handoff. Repository is clean (no uncommitted changes) at commit `8e33151` on `main`.*
