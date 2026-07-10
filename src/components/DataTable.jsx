'use client';
// جدول موحّد — <table> حقيقي واحد لكل المقاسات:
// على الديسكتوب جدول عادي، وعلى الجوال (≤768px حيث يخفي globals.css رأس الجدول)
// تُعنوَن كل خلية تلقائياً عبر data-label + ::before فلا تظهر قيم مكدسة بلا سياق.
import { useState } from 'react';
import { Ltr } from './format';

export default function DataTable({
  columns,        // [{ key, label, render?, align?, ltr?, width?, hideMobile?, className?, primary? }]
                  // primary: العمود الرئيسي (الاسم عادة) — لا تُعرض له تسمية على الجوال
  rows,
  rowKey,         // (row, i) => key — الافتراضي row.id ثم i
  onRowClick,
  empty,          // عنصر يُعرض عند غياب الصفوف (عادة <Empty/>)
  footer,         // <tr>…</tr> داخل tfoot
  className = '',
  pageSize,       // اختياري: يعرض أول pageSize صفاً + زر «عرض المزيد»
}) {
  const [limit, setLimit] = useState(pageSize || Infinity);
  if (!rows?.length) return empty || null;
  const visible = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : row.id ?? i);

  return (
    <>
      <table className={className}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ ...(c.width ? { width: c.width } : null), ...(c.align ? { textAlign: c.align } : null) }}
                className={c.hideMobile ? 'hide-mobile' : undefined}
              >{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => {
                const raw = c.render ? c.render(row, i) : row[c.key];
                return (
                  <td
                    key={c.key}
                    data-label={c.primary ? '' : (typeof c.label === 'string' ? c.label : '')}
                    style={c.align ? { textAlign: c.align } : undefined}
                    className={[c.hideMobile ? 'hide-mobile' : '', c.className || ''].join(' ').trim() || undefined}
                  >{c.ltr ? <Ltr>{raw}</Ltr> : raw}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {rows.length > visible.length && (
        <div className="pagination">
          <button type="button" className="btn ghost sm" onClick={() => setLimit((l) => l + pageSize)}>
            عرض المزيد
          </button>
          <span><span className="amt" dir="ltr">{visible.length}</span> من <span className="amt" dir="ltr">{rows.length}</span></span>
        </div>
      )}
    </>
  );
}
