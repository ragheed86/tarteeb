'use client';
import { useEffect, useState } from 'react';
import { getTrialBalance } from '@/lib/data';
import { fmtMoney } from '@/lib/format';
import { Loading, Empty, ErrorBar, DataTable, Input, Money } from '@/components';

const today = () => new Date().toISOString().slice(0, 10);
const TYPE_LABEL = { asset: 'أصل', liability: 'خصم', equity: 'حقوق ملكية', revenue: 'إيراد', expense: 'مصروف' };

export default function TrialBalancePage() {
  const [asOf, setAsOf] = useState(today);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try { setRows(await getTrialBalance(asOf)); } catch (loadError) { setError(loadError.message || 'تعذّر تحميل ميزان المراجعة'); }
    })();
  }, [asOf]);

  if (error) return <ErrorBar message={error} />;

  const totalDebit = (rows || []).reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const totalCredit = (rows || []).reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <>
      <div className="sec-head"><div><h2>ميزان المراجعة</h2><p>إجمالي المدين والدائن لكل حساب تحرّك، حتى تاريخ معيّن — يجب أن يتوازن.</p></div></div>

      <div className="card" style={{ display: 'flex', gap: 12, padding: 14, marginBottom: 14 }}>
        <Input label="حتى تاريخ" type="date" value={asOf} ltr onChange={(e) => setAsOf(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {!rows ? <Loading /> : (
          <DataTable
            rows={rows}
            empty={<Empty title="لا حركة محاسبية حتى هذا التاريخ" desc="غيّر التاريخ." />}
            columns={[
              { key: 'code', label: 'الكود', primary: true, ltr: true, width: 80 },
              { key: 'name_ar', label: 'الحساب' },
              { key: 'account_type', label: 'النوع', render: (row) => TYPE_LABEL[row.account_type] || row.account_type },
              { key: 'debit', label: 'مدين', render: (row) => <Money v={row.debit} /> },
              { key: 'credit', label: 'دائن', render: (row) => <Money v={row.credit} /> },
              { key: 'balance', label: 'الرصيد', render: (row) => <Money v={row.balance} /> },
            ]}
            footer={
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3}>الإجمالي</td>
                <td><span dir="ltr">{fmtMoney(totalDebit)} ⃁</span></td>
                <td><span dir="ltr">{fmtMoney(totalCredit)} ⃁</span></td>
                <td style={{ color: balanced ? 'var(--pos)' : 'var(--neg)' }}>{balanced ? 'متوازن ✓' : 'غير متوازن!'}</td>
              </tr>
            }
          />
        )}
      </div>
    </>
  );
}
