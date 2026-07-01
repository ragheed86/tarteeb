'use client';
import { useEffect, useState } from 'react';
import {
  getInventory, getWarehouses, getCategories, getSuppliers,
  createInventoryItem, updateInventoryItem, removeInventoryItem,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const EMPTY = {
  name: '', barcode: '', category_id: '', unit: 'قطعة', quantity: '', reorder_level: '',
  unit_cost: '', supplier_id: '', warehouse_id: '',
};

export default function WarehousePage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [fCat, setFCat] = useState('');
  const [fWh, setFWh] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [productImage, setProductImage] = useState({ name: '', preview: '' });
  const [barcodeImage, setBarcodeImage] = useState({ name: '', preview: '' });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  async function load() {
    try {
      const [items, warehouses, categories, suppliers] = await Promise.all([
        getInventory(), getWarehouses(), getCategories(), getSuppliers(),
      ]);
      setD({ items, warehouses, categories, suppliers });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function resetImages() {
    setProductImage({ name: '', preview: '' });
    setBarcodeImage({ name: '', preview: '' });
  }
  function openAdd() { setEditing(null); setForm(EMPTY); resetImages(); setFormErr(''); setOpen(true); }
  function openEdit(it) {
    setEditing(it);
    setForm({
      name: it.name || '', barcode: it.barcode || '', category_id: it.category_id || '',
      unit: it.unit || 'قطعة', quantity: it.quantity ?? '', reorder_level: it.reorder_level ?? '',
      unit_cost: it.unit_cost ?? '', supplier_id: it.supplier_id || '', warehouse_id: it.warehouse_id || '',
    });
    resetImages();
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); resetImages(); } }

  function handleProductImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductImage({ name: file.name, preview: URL.createObjectURL(file) });
  }

  async function handleBarcodeImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBarcodeImage({ name: file.name, preview: URL.createObjectURL(file) });
    if (!('BarcodeDetector' in window)) {
      setFormErr('تمت إضافة صورة الباركود. إذا لم يظهر الرقم تلقائياً أدخله يدوياً.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'],
      });
      const codes = await detector.detect(bitmap);
      if (codes[0]?.rawValue) {
        set('barcode', codes[0].rawValue);
        setFormErr('');
      } else {
        setFormErr('تمت إضافة صورة الباركود، لكن لم يتم قراءة الرقم تلقائياً.');
      }
    } catch {
      setFormErr('تمت إضافة صورة الباركود، لكن لم يتم قراءة الرقم تلقائياً.');
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم الصنف مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      name: form.name.trim(), barcode: form.barcode.trim() || null,
      category_id: form.category_id || null, unit: form.unit.trim() || 'قطعة',
      quantity: Number(form.quantity) || 0, reorder_level: Number(form.reorder_level) || 0,
      unit_cost: Number(form.unit_cost) || 0, supplier_id: form.supplier_id || null,
      warehouse_id: form.warehouse_id || null,
    };
    try {
      if (editing) {
        const up = await updateInventoryItem(editing.id, payload);
        setD((s) => ({ ...s, items: s.items.map((x) => (x.id === up.id ? up : x)) }));
      } else {
        const ni = await createInventoryItem(payload);
        setD((s) => ({ ...s, items: [ni, ...s.items] }));
      }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(it) {
    if (!confirm(`حذف الصنف «${it.name}»؟`)) return;
    try { await removeInventoryItem(it.id); setD((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { items, warehouses, categories, suppliers } = d;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const whName = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));
  const supName = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const filtered = items.filter((it) =>
    (!fCat || it.category_id === fCat) && (!fWh || it.warehouse_id === fWh));
  const lowCount = items.filter((it) => Number(it.quantity) < Number(it.reorder_level)).length;
  const warehouseStats = warehouses.map((warehouse) => {
    const rows = items.filter((item) => item.warehouse_id === warehouse.id);
    return {
      id: warehouse.id,
      name: warehouse.name,
      count: rows.length,
      cost: rows.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0), 0),
    };
  });
  const visibleStats = warehouseStats.slice(0, 3);

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          صنف جديد
        </button>
        <select className="filter-sel" value={fCat} onChange={(e) => setFCat(e.target.value)} style={{ marginInlineStart: 'auto' }}>
          <option value="">كل التصنيفات</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="filter-sel" value={fWh} onChange={(e) => setFWh(e.target.value)}>
          <option value="">كل المستودعات</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <span className="more">{fmtNum(filtered.length)} صنف{lowCount > 0 ? ` · ${fmtNum(lowCount)} ناقص` : ''}</span>
      </div>

      <div className="warehouse-stats">
        {visibleStats.map((warehouse) => (
          <div className="warehouse-stat" key={warehouse.id}>
            <div>
              <b>{warehouse.name}</b>
              <span>{fmtNum(warehouse.count)} صنف</span>
            </div>
            <strong className="amt">{fmtMoney(warehouse.cost)} ⃁</strong>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        {filtered.length === 0 ? (
          <Empty title="لا أصناف" desc="أضف أصناف المخزون لإدارتها هنا." />
        ) : (
          <table>
            <thead><tr><th>الصنف</th><th>التصنيف</th><th>المستودع</th><th>الكمية</th><th>حد التنبيه</th><th>التكلفة</th><th>المورّد</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => {
                const low = Number(it.quantity) < Number(it.reorder_level);
                return (
                  <tr key={it.id} className={low ? 'row-low' : ''}>
                    <td>
                      <span className="nm">{it.name}</span>
                      {it.barcode && <><br /><span className="uid amt">{it.barcode}</span></>}
                    </td>
                    <td>{catName[it.category_id] || '—'}</td>
                    <td>{whName[it.warehouse_id] || '—'}</td>
                    <td className="amt">
                      {fmtNum(it.quantity)} {it.unit}
                      {low && <span className="pill p-cancel" style={{ marginInlineStart: 6 }}>ناقص</span>}
                    </td>
                    <td className="amt">{fmtNum(it.reorder_level)}</td>
                    <td className="amt">{fmtMoney(it.unit_cost)} ⃁</td>
                    <td>{supName[it.supplier_id] || '—'}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(it)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(it)}>حذف</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل صنف' : 'صنف جديد'}</h2><p>إضافة صنف إلى المخزون</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field span-2"><label>اسم الصنف</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></div>
              <div className="field span-2">
                <label>صورة المنتج</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="product-image">رفع صورة المنتج</label>
                  <input id="product-image" type="file" accept="image/*" hidden onChange={handleProductImage} />
                  {productImage.name && <span>{productImage.name}</span>}
                </div>
                {productImage.preview && <img className="upload-preview" src={productImage.preview} alt="صورة المنتج" />}
              </div>
              <div className="field"><label>الباركود</label><input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} dir="ltr" /></div>
              <div className="field">
                <label>تصوير الباركود</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="barcode-image">تصوير الباركود</label>
                  <input id="barcode-image" type="file" accept="image/*" capture="environment" hidden onChange={handleBarcodeImage} />
                </div>
                {barcodeImage.preview && <img className="upload-preview barcode" src={barcodeImage.preview} alt="صورة الباركود" />}
              </div>
              <div className="field"><label>الوحدة</label><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></div>
              <div className="field"><label>التصنيف</label>
                <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>المستودع</label>
                <select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field"><label>الكمية</label><input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>حد التنبيه</label><input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>تكلفة الوحدة (⃁)</label><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>المورّد</label>
                <select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الصنف'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
