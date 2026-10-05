// ============================================================
//  سجلات بنيوية (structured logs) — مهمة 15 (تجهيز CI ومراقبة الإنتاج)
//  سطر JSON واحد لكل حدث: يسهل فهرسته وربطه بـrequestId في أي أداة
//  مراقبة (Vercel Logs، Datadog، إلخ) بلا حاجة لمزوّد خارجي بعد.
// ============================================================
function write(level, message, meta = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
