'use client';
import { useEffect, useState } from 'react';
import { getChartOfAccounts, getLedger } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar, DataTable, Select, Input, Money } from '@/components';

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${today().slice(0, 4)}-01-01`;

export default function LedgerPage() {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getChartOfAccounts().then((list) => {
      setAccounts(list);
      if (!list.length) return;
      const parentIds = new Set(list.map((a) => a.parent_id).filter(Boolean));
      const leaf = list.find((a) => a.code === '1120') || list.find((a) => a.account_type === 'asset' && !parentIds.has(a.id)) || list[0];
      setAccountId(leaf.id);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try { setRows(await getLedger(accountId, from, to)); } catch (loadError) { setError(loadError.message || 'تعذّر تحميل دفتر الأستاذ'); }
    })();
  }, [accountId, from, to]);

  if (error) return <ErrorBar message={error} />;
  if (!accounts) return <Loading />;

  return (
    <>
      <div className="sec-head"><div><h2>دفتر الأستاذ</h2><p>حركات حساب واحد ورصيده التراكمي.</p></div></div>

      <div className="card" style={{ display: 'flex', gap: 12, padding: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <Select label="الحساب" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name_ar}` }))} />
        <Input label="من تاريخ" type="date" value={from} ltr onChange={(e) => setFrom(e.target.value)} />
        <Input label="إلى تاريخ" type="date" value={to} ltr onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {!rows ? <Loading /> : (
          <DataTable
            rows={rows}
            empty={<Empty title="لا حركة على هذا الحساب ضمن الفترة" desc="غيّر الحساب أو فلتر التاريخ." />}
            columns={[
              { key: 'entry_no', label: 'رقم القيد', primary: true, ltr: true },
              { key: 'entry_date', label: 'التاريخ', render: (row) => fmtDate(row.entry_date) },
              { key: 'description', label: 'الوصف' },
              { key: 'debit', label: 'مدين', render: (row) => <Money v={row.debit} /> },
              { key: 'credit', label: 'دائن', render: (row) => <Money v={row.credit} /> },
              { key: 'running_balance', label: 'الرصيد التراكمي', render: (row) => <Money v={row.running_balance} /> },
            ]}
          />
        )}
      </div>
    </>
  );
}
