export function cleanWorkerName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFreelanceWorker(value) {
  const name = cleanWorkerName(value);
  return name.includes('فريلانسر') || name.includes('freelance') || name.includes('freelancer');
}

export function isSupervisorWorker(value) {
  const name = cleanWorkerName(value);
  if (!name) return false;
  return (
    name.includes('مشرف') ||
    name.includes('supervisor') ||
    name.includes('رغيد') ||
    name.includes('ragheed') ||
    name.includes('دلال') ||
    name.includes('dalal') ||
    name.includes('زين') ||
    name.includes('zain')
  );
}

export function isSupervisorLaborRow(row) {
  return (
    row?.role === 'supervisor' ||
    isSupervisorWorker(row?.worker) ||
    isSupervisorWorker(row?.worker_name) ||
    isSupervisorWorker(row?.note) ||
    isSupervisorWorker(row?.label)
  );
}

export function defaultHourlyRateForWorker(value) {
  const name = cleanWorkerName(value);
  if (!name) return '';
  if (isFreelanceWorker(name)) return '20';
  if (name.includes('رغيد') || name.includes('ragheed') || name.includes('دلال') || name.includes('dalal')) return '200';
  if (name.includes('زين') || name.includes('zain')) return '400';
  return '';
}
