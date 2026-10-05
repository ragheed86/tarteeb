import { defaultHourlyRateForWorker, isFreelanceWorker, isSupervisorLaborRow } from '@/lib/labor';

export function num(value) {
  return Number(value) || 0;
}

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysISO(value, days) {
  const d = parseISODate(value) || new Date();
  d.setDate(d.getDate() + days);
  return isoLocal(d);
}

export function plannedProjectDays(project) {
  const start = project?.start_date || project?.due_date || isoLocal(new Date());
  const due = project?.due_date || start;
  const s = parseISODate(start);
  const e = parseISODate(due);
  const count = s && e ? Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1) : 1;
  return Array.from({ length: count }, (_, i) => addDaysISO(start, i));
}

export const emptyLabor = () => ({ id: makeId('labor'), workerCount: '', worker: '', workerType: '', employeeId: '', hours: '', rate: '' });
export const emptyProduct = () => ({ id: makeId('product'), product: '', supplierId: '', supplierName: '', purchasePrice: '', markupPercent: '', salePrice: '' });
export const emptyMoney = (prefix) => ({ id: makeId(prefix), note: '', amount: '' });
export const emptyDay = (date) => ({ date, laborRows: [emptyLabor()], productRows: [emptyProduct()], transportRows: [], otherRows: [] });

export function normalizeDay(day) {
  return {
    date: day.date,
    laborRows: day.laborRows?.length ? day.laborRows.map((r) => ({
      ...emptyLabor(),
      ...r,
      workerCount: r.workerCount ?? r.count ?? r.qty ?? (r.person ? 1 : ''),
      worker: r.worker ?? r.person ?? '',
      role: r.role || (isSupervisorLaborRow(r) ? 'supervisor' : 'worker'),
      id: r.id || makeId('labor'),
    })) : [emptyLabor()],
    productRows: day.productRows?.length ? day.productRows.map((r) => ({ ...emptyProduct(), ...r, id: r.id || makeId('product') })) : [emptyProduct()],
    transportRows: (day.transportRows || []).map((r) => ({ ...emptyMoney('transport'), ...r, id: r.id || makeId('transport') })),
    otherRows: (day.otherRows || []).map((r) => ({ ...emptyMoney('other'), ...r, id: r.id || makeId('other') })),
  };
}

export function buildDailyRows(project, savedRows) {
  const savedByDate = new Map((savedRows || []).map((d) => [d.date, d]));
  const dates = new Set([...plannedProjectDays(project), ...(savedRows || []).map((d) => d.date)]);
  return Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => normalizeDay(savedByDate.get(date) || emptyDay(date)));
}

export function isOrganizersProduct(row) {
  return /منظمات?|منظّمات?|أدوات\s*الترتيب|ادوات\s*الترتيب|التخزين/i.test(row?.product || '');
}

export function calcDay(day) {
  const labor = (day.laborRows || []).reduce((s, r) => s + num(r.workerCount) * num(r.hours) * num(r.rate), 0);
  const productRows = day.productRows || [];
  const productsCost = productRows.reduce((s, r) => s + num(r.purchasePrice), 0);
  const productsSale = productRows.reduce((s, r) => s + num(r.salePrice), 0);
  const organizersCost = productRows.filter(isOrganizersProduct).reduce((s, r) => s + num(r.purchasePrice), 0);
  const organizersSale = productRows.filter(isOrganizersProduct).reduce((s, r) => s + num(r.salePrice), 0);
  const transport = (day.transportRows || []).reduce((s, r) => s + num(r.amount), 0);
  const other = (day.otherRows || []).reduce((s, r) => s + num(r.amount), 0);
  const serviceCost = labor + (productsCost - organizersCost) + transport + other;
  return {
    labor, productsCost, productsSale, organizersCost, organizersSale, transport, other,
    serviceCost,
    total: serviceCost + organizersCost,
  };
}

export function updateRow(rows, id, key, value, suppliers) {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, [key]: value };
    if (key === 'supplierId') {
      const supplier = suppliers.find((s) => s.id === value);
      next.supplierName = supplier?.name || '';
    }
    if (key === 'purchasePrice' || key === 'markupPercent' || key === 'supplierId') {
      const purchase = num(next.purchasePrice);
      const pct = num(next.markupPercent);
      next.salePrice = purchase > 0 ? String(Math.round((purchase * (1 + pct / 100)) * 100) / 100) : '';
    }
    return next;
  });
}

// الأساسي: سعر الساعة تلقائي من تكلفته الشهرية الكاملة ÷ ساعات العمل (يُحمَّل داخلياً على المشروع).
// بالساعة: سعر يدوي (الافتراضي للفريلانسر 20).
export function updateLaborRow(rows, id, key, value, employees = [], rates = {}) {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, [key]: value };
    if (key === 'worker') {
      next.role = isSupervisorLaborRow({ worker: value }) ? 'supervisor' : 'worker';
      const employee = employees.find((em) => em.name === value);
      if (employee) {
        next.workerType = 'employee';
        next.employeeId = employee.id;
        next.workerCount = '1';
        const auto = rates[employee.id];
        const fallback = defaultHourlyRateForWorker(value);
        if (auto) next.rate = String(auto);
        else if (fallback) next.rate = fallback;
      } else {
        next.employeeId = '';
        next.workerType = value ? 'part_time' : '';
        if (value && !isFreelanceWorker(value)) next.workerCount = '1';
        const defaultRate = defaultHourlyRateForWorker(value);
        if (defaultRate) next.rate = defaultRate;
      }
    }
    if (key === 'workerType') {
      if (value === 'part_time') {
        next.employeeId = '';
      } else if (value === 'employee') {
        const employee = employees.find((em) => em.name === r.worker);
        if (employee) {
          next.employeeId = employee.id;
          if (rates[employee.id]) next.rate = String(rates[employee.id]);
        }
      }
    }
    return next;
  });
}
