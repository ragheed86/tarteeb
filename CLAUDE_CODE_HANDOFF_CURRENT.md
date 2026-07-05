# Tarteeb Handoff - 2026-07-04

## Current Project

- Local project path: `/Users/Ragheed/Developer/tarteeb`
- Live site: `https://tarteeb-six.vercel.app`
- Vercel project: `tarteeb/tarteeb-six`
- Vercel project id: `prj_Y9y1fU7PmWbkGuw0ZFBbO1FKWkCs`
- Supabase project ref: `yvxequegdyrhjghprnya`
- Main app credentials were provided by the user in chat, but do not print or commit them.

## First Thing To Do

```bash
cd /Users/Ragheed/Developer/tarteeb
git status --short
npm run build
```

The worktree currently has local changes and untracked files. Do not reset them. They are intentional.

## Recent Deployed State

Latest requested work was deployed successfully to production with:

```bash
npx vercel --prod --yes
```

The deployment aliased to:

`https://tarteeb-six.vercel.app`

Key live checks passed with `HTTP 200`, including:

- `/projects`
- `/cost`
- `/projects/60fee63a-9524-47fd-9f5d-5fe2cd30f35e/report`
- `/reports/khawla-expense-report.html`

## Important Files Changed Recently

- `src/app/projects/page.js`
- `src/app/cost/page.js`
- `src/app/projects/[id]/page.js`
- `src/app/projects/[id]/report/page.js`
- `src/app/globals.css`
- `src/lib/data.js`
- `public/reports/khawla-expense-report.html`

## Projects Page `/projects`

Current behavior:

- Shows all projects by default.
- Date filters start empty by default.
- Search supports project title, client name, client phone/district/code, and dates.
- Pagination: 10 projects per page.
- Pagination applies to all views:
  - cards
  - kanban
  - calendar
- Button `عرض كل المشاريع` clears search/date filters.
- The new/add project modal is now only initial project info. It no longer includes labor/product/other cost inputs, to avoid conflicting with `/cost`.

Important: cost entry should happen in `/cost`, not in `/projects`.

## Cost Page `/cost`

Current behavior:

- Shows all project work days on one page.
- Days are generated from project start/due dates and can be extended with `+ إضافة يوم عمل`.
- Labor is now calculated by grouped worker count, not by person name:

```text
عدد العمال × ساعات العامل × سعر الساعة = الإجمالي
```

- Labor table fields:
  - عدد العمال
  - ساعات العامل
  - إجمالي الساعات
  - سعر الساعة
  - الإجمالي
- Project products still support supplier, purchase price, markup %, and total sale value.
- Suppliers are loaded from the suppliers table.
- There is a `مرفقات الفواتير` button. It lists invoices connected to the selected project and opens the invoice in the same app tab.
- There is a `تقرير PDF` button that opens `/projects/[id]/report`.

Implementation details:

- `src/app/cost/page.js`
  - labor row uses `workerCount`, `hours`, `rate`.
  - total labor calculation is `workerCount * hours * rate`.
- `src/lib/data.js`
  - daily labor saves `qty = workerCount`.
  - legacy daily rows that had a person name are normalized as `workerCount = 1`.

## Project Cost Data For Khawla

Client found in Supabase:

- Client: `خولة`
- Phone: `+966533304433`
- District: `الملك عبد الله`
- Client id: `ae7c215e-a3a5-486a-9b40-3fcda3ed9c54`

Project:

- Project id: `60fee63a-9524-47fd-9f5d-5fe2cd30f35e`
- Title: `ترتيب غرفة ملابس`
- Service type: `ترتيب غرفة نوم ماسترز`
- Sale price in project table: originally `5000`, but the static report was changed to show `10000`.
- Start date: `2026-07-02`
- Due date: `2026-07-03`

Costs inserted in `project_costs`:

Day 1, 2 July:

- `عمالة (4 عاملات × 8 ساعات) - اليوم الأول 2 يوليو` = 640
- `مواصلات - اليوم الأول 2 يوليو` = 87
- `مشرف: رغيد - اليوم الأول 2 يوليو` = 200
- `مشرف: غيداء - اليوم الأول 2 يوليو` = 168.75
- `مشرف: زينة - اليوم الأول 2 يوليو` = 400
- Day 1 total = 1495.75

Day 2, 3 July:

- `عمالة (5 عاملات × 5.5 ساعات) - اليوم الثاني 3 يوليو` = 550
- `عمالة (عاملة × 4 ساعات و45 دقيقة) - اليوم الثاني 3 يوليو` = 95
- `مواصلات - اليوم الثاني 3 يوليو` = 120
- `مشرف: رغيد - اليوم الثاني 3 يوليو` = 300
- `مشرف: زينة - اليوم الثاني 3 يوليو` = 400
- Day 2 total = 1465

Total recorded cost = `2960.75`.

Note: The user mentioned `العلاقات = 2160`. In the static report this is shown as a material line, but it is not inserted into `project_costs`.

## Expense Report Work

The user approved the report model and asked to use it for all projects.

Implemented:

- Dynamic report route:

```text
/projects/[id]/report
```

- Example:

```text
https://tarteeb-six.vercel.app/projects/60fee63a-9524-47fd-9f5d-5fe2cd30f35e/report
```

- Added report button in:
  - `src/app/projects/[id]/page.js` as `تقرير المصاريف PDF`
  - `src/app/cost/page.js` as `تقرير PDF`

Static prototype file still exists:

```text
public/reports/khawla-expense-report.html
```

Static report URL:

```text
https://tarteeb-six.vercel.app/reports/khawla-expense-report.html
```

Current report design:

- Modern header
- KPI metrics
- compact project/client info
- labor/cost indicators
- expense details grouped by day
- materials section
- print button

Report printing:

- User requested A4 portrait, single page, less unnecessary information.
- Current print CSS uses:

```css
@page { size: A4 portrait; margin: 5mm; }
```

- It hides non-print app UI.
- It compresses sizes for one-page output.
- Static report PDF was tested via headless Chrome:
  - Pages: `1`
  - Page size: `594.96 x 841.92 pts (A4)`

Fields removed from the report per user request:

- phone number
- temporary work difficulty field
- repeated financial result section
- signatures
- long notes

## Static Report Values

The static Khawla report was manually changed to:

- Project value: `10,000 ريال`
- Recorded expenses: `2,960.75 ريال`
- Net profit: `7,039.25 ريال`
- Profit margin: `70.4%`
- Source: `تيك توك`

Important: The dynamic report reads `project.sale_price` from Supabase. If the dynamic Khawla report must also show `10,000`, update the project sale price in Supabase or add a report override field. Do not hardcode dynamic project values unless user explicitly asks.

## Known Data/Schema Notes

- `project_costs` has extra columns currently used by the app:
  - `qty`
  - `hours`
  - `rate`
- Daily cost rows are serialized into `project_costs.label` with labels starting `يومي:` for rows saved from `/cost`.
- Manual inserted Khawla rows use labels like `اليوم الأول 2 يوليو` and are grouped by report parsing logic.
- There is no real invoice attachment table yet. The invoice attachment button currently lists linked invoices.
- File upload/storage is still URL/preview based in several areas. Supabase Storage is not fully implemented.

## Build/Deploy Commands

```bash
cd /Users/Ragheed/Developer/tarteeb
npm run build
npx vercel --prod --yes
```

Verify after deploy:

```bash
curl -I https://tarteeb-six.vercel.app/projects
curl -I https://tarteeb-six.vercel.app/cost
curl -I https://tarteeb-six.vercel.app/projects/60fee63a-9524-47fd-9f5d-5fe2cd30f35e/report
```

## Suggested Next Steps

1. Decide whether Khawla project `sale_price` in Supabase should become `10000` to match the approved report.
2. Add real report fields to the database if needed:
   - work difficulty
   - report-specific project value
   - materials used not counted as expenses
   - notes
3. Add real invoice attachment upload/storage if the user asks again.
4. Consider generating PDF server-side later. Current solution relies on browser print/save PDF.
