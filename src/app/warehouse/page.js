'use client';
import { useEffect, useRef, useState } from 'react';
import {
  getInventory, getWarehouses, getCategories, getSuppliers,
  createInventoryItem, updateInventoryItem, removeInventoryItem,
  uploadProductImage, removeProductImage,
} from '@/lib/data';
import { canAccess } from '@/lib/permissions';
import { useAccess } from '@/lib/useAccess';
import { fmtMoney, fmtNum } from '@/lib/format';
import { decodeBarcodeFromFile, startBarcodeScanner } from '@/lib/barcode';
import { Loading, Empty, ErrorBar } from '../ui';

const EMPTY = {
  name: '', barcode: '', category_id: '', unit: 'قطعة', quantity: '', reorder_level: '',
  unit_cost: '', supplier_id: '', warehouse_id: '',
};

function BarcodeIcon({ size = 15 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6v12M7 6v12M10.5 6v12M14 6v8M14 17.5v.5M17.5 6v12M21 6v12" />
    </svg>
  );
}

function ProductThumb({ item }) {
  if (item.image_url) {
    return <img className="prod-thumb" src={item.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
  }
  return (
    <span className="prod-thumb prod-thumb-empty">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" /></svg>
    </span>
  );
}

function SupplierCell({ supplier }) {
  if (!supplier) return <>—</>;
  return (
    <span className="sup-cell">
      {supplier.logo_url
        ? <img className="sup-logo" src={supplier.logo_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <span className="sup-logo sup-logo-fallback">{(supplier.name || '؟').slice(0, 1)}</span>}
      {supplier.name}
    </span>
  );
}

export default function WarehousePage() {
  const [d, setD] = useState(null);
  const { access } = useAccess();
  const [err, setErr] = useState('');
  const [fCat, setFCat] = useState('');
  const [fWh, setFWh] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inventorying, setInventorying] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [inventoryForm, setInventoryForm] = useState({ quantity: '', reorder_level: '' });
  const [productImage, setProductImage] = useState({ name: '', preview: '' });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [decoding, setDecoding] = useState(false);
  const videoRef = useRef(null);
  const stopScanRef = useRef(null);

  async function load() {
    try {
      const [items, warehouses, categories, suppliers] = await Promise.all([
        getInventory(), getWarehouses(), getCategories(), getSuppliers(),
      ]);
      setD({ items, warehouses, categories, suppliers });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => () => { stopScanRef.current?.(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setInventory(k, v) { setInventoryForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY); setProductImage({ name: '', preview: '' }); setFormErr(''); setOpen(true); }
  function openEdit(it) {
    setEditing(it);
    setForm({
      name: it.name || '', barcode: it.barcode || '', category_id: it.category_id || '',
      unit: it.unit || 'قطعة', quantity: it.quantity ?? '', reorder_level: it.reorder_level ?? '',
      unit_cost: it.unit_cost ?? '', supplier_id: it.supplier_id || '', warehouse_id: it.warehouse_id || '',
    });
    setProductImage({ name: '', preview: it.image_url || '' });
    setFormErr(''); setOpen(true);
  }
  function openInventory(it) {
    setInventorying(it);
    setInventoryForm({ quantity: it.quantity ?? '', reorder_level: it.reorder_level ?? '' });
    setFormErr('');
  }
  function close() { if (!saving) { stopScan(); setOpen(false); setEditing(null); setProductImage({ name: '', preview: '' }); } }
  function closeInventory() { if (!saving) { setInventorying(null); setInventoryForm({ quantity: '', reorder_level: '' }); } }

  function handleProductImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductImage({ name: file.name, preview: URL.createObjectURL(file), file });
  }

  function stopScan() {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setScanning(false);
    setScanErr('');
  }

  async function startScan() {
    setScanErr('');
    setScanning(true);
    // ننتظر ظهور عنصر الفيديو في الـDOM
    requestAnimationFrame(async () => {
      try {
        if (!videoRef.current) throw new Error('no-video');
        stopScanRef.current = await startBarcodeScanner(videoRef.current, (text) => {
          set('barcode', text);
          setFormErr('');
          stopScan();
        });
      } catch (e2) {
        setScanning(false);
        setScanErr(e2?.name === 'NotAllowedError'
          ? 'تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح ثم أعد المحاولة.'
          : 'تعذّر فتح الكاميرا. يمكنك التقاط صورة للباركود بدلاً من ذلك.');
      }
    });
  }

  async function handleBarcodeImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDecoding(true); setScanErr('');
    const text = await decodeBarcodeFromFile(file);
    setDecoding(false);
    if (text) { set('barcode', text); setFormErr(''); }
    else setScanErr('لم يُقرأ الباركود من الصورة — قرّب الكاميرا وحاول مجدداً أو أدخل الرقم يدوياً.');
  }

  async function submit(e) {
    e.preventDefault();
    if (!canAccess(access, 'warehouse_products')) { setFormErr('لا تملك صلاحية إضافة أو تعديل المنتجات'); return; }
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
      if (productImage.file) {
        const img = await uploadProductImage(productImage.file);
        payload.image_url = img.url;
        payload.image_path = img.path;
      }
      if (editing) {
        const up = await updateInventoryItem(editing.id, payload);
        if (payload.image_path && editing.image_path) removeProductImage(editing.image_path);
        setD((s) => ({ ...s, items: s.items.map((x) => (x.id === up.id ? up : x)) }));
      } else {
        const ni = await createInventoryItem(payload);
        setD((s) => ({ ...s, items: [ni, ...s.items] }));
      }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function submitInventory(e) {
    e.preventDefault();
    if (!canAccess(access, 'warehouse_inventory')) { setFormErr('لا تملك صلاحية الجرد'); return; }
    if (!inventorying) return;
    setSaving(true); setFormErr('');
    try {
      const up = await updateInventoryItem(inventorying.id, {
        quantity: Number(inventoryForm.quantity) || 0,
        reorder_level: Number(inventoryForm.reorder_level) || 0,
      });
      setD((s) => ({ ...s, items: s.items.map((x) => (x.id === up.id ? up : x)) }));
      closeInventory();
    } catch (e2) { setFormErr(e2.message || 'تعذّر حفظ الجرد'); }
    finally { setSaving(false); }
  }
  async function del(it) {
    if (!canAccess(access, 'warehouse_products')) { setErr('لا تملك صلاحية حذف المنتجات'); return; }
    if (!confirm(`حذف الصنف «${it.name}»؟`)) return;
    try { await removeInventoryItem(it.id, it.image_path); setD((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d || access === undefined) return <Loading />;

  const { items, warehouses, categories, suppliers } = d;
  const canManageProducts = canAccess(access, 'warehouse_products');
  const canRunInventory = canAccess(access, 'warehouse_inventory');
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const whName = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));

  const itemValue = (it) => (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0);
  const filtered = items.filter((it) =>
    (!fCat || it.category_id === fCat) && (!fWh || it.warehouse_id === fWh));
  const lowCount = items.filter((it) => Number(it.quantity) < Number(it.reorder_level)).length;
  const totalStockValue = items.reduce((sum, it) => sum + itemValue(it), 0);
  const warehouseStats = warehouses.map((warehouse) => {
    const rows = items.filter((item) => item.warehouse_id === warehouse.id);
    return {
      id: warehouse.id,
      name: warehouse.name,
      count: rows.length,
      cost: rows.reduce((sum, item) => sum + itemValue(item), 0),
    };
  });
  const visibleStats = warehouseStats.slice(0, 3);
  const formValue = (Number(form.quantity) || 0) * (Number(form.unit_cost) || 0);

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        {canManageProducts && (
          <button className="btn" onClick={openAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            صنف جديد
          </button>
        )}
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

      {!canManageProducts && !canRunInventory && (
        <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: '#bcd4c5', color: '#2c5347' }}>
          لديك صلاحية عرض المستودع فقط.
        </div>
      )}

      <div className="warehouse-stats">
        <div className="warehouse-stat warehouse-stat-total">
          <div>
            <b>إجمالي قيمة المخزون</b>
            <span>{fmtNum(items.length)} صنف في كل المستودعات</span>
          </div>
          <strong className="amt">{fmtMoney(totalStockValue)} ⃁</strong>
        </div>
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
          <Empty title="لا أصناف" desc={canManageProducts ? 'أضف أصناف المخزون لإدارتها هنا.' : 'لا توجد أصناف مطابقة للفلاتر الحالية.'} />
        ) : (
          <table className="wh-table">
            <thead><tr><th>الصنف</th><th>التصنيف</th><th>المستودع</th><th>الكمية</th><th>حد التنبيه</th><th>تكلفة الوحدة</th><th>قيمة المخزون</th><th>المورّد</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => {
                const low = Number(it.quantity) < Number(it.reorder_level);
                return (
                  <tr key={it.id} className={low ? 'row-low' : ''}>
                    <td>
                      <span className="prod-cell">
                        <ProductThumb item={it} />
                        <span className="prod-info">
                          <span className="nm">{it.name}</span>
                          {it.barcode && <span className="uid amt bc-code"><BarcodeIcon size={13} />{it.barcode}</span>}
                        </span>
                      </span>
                    </td>
                    <td>{catName[it.category_id] || '—'}</td>
                    <td>{whName[it.warehouse_id] || '—'}</td>
                    <td className="amt">
                      {fmtNum(it.quantity)} {it.unit}
                      {low && <span className="pill p-cancel" style={{ marginInlineStart: 6 }}>ناقص</span>}
                    </td>
                    <td className="amt">{fmtNum(it.reorder_level)}</td>
                    <td className="amt">{fmtMoney(it.unit_cost)} ⃁</td>
                    <td className="amt"><b>{fmtMoney(itemValue(it))}</b> ⃁</td>
                    <td><SupplierCell supplier={supById[it.supplier_id]} /></td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      {canRunInventory && (
                        <button className="btn ghost sm act-ico" title="جرد" aria-label="جرد" onClick={() => openInventory(it)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12l2 2 4-4" /></svg>
                        </button>
                      )}
                      {canManageProducts && (
                        <button className="btn ghost sm act-ico" title="تعديل" aria-label="تعديل" style={{ marginInlineStart: canRunInventory ? 6 : 0 }} onClick={() => openEdit(it)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                        </button>
                      )}
                      {canManageProducts && (
                        <button className="btn ghost sm act-ico" title="حذف" aria-label="حذف" style={{ marginInlineStart: 6, color: 'var(--neg)' }} onClick={() => del(it)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></svg>
                        </button>
                      )}
                      {!canRunInventory && !canManageProducts && <span className="uid">—</span>}
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
              <div className="field span-2"><label>اسم الصنف</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>

              <div className="field span-2">
                <label><span className="lbl-ico"><BarcodeIcon /></span> الباركود</label>
                <div className="bc-row">
                  <div className="bc-input">
                    <span className="bc-input-ico"><BarcodeIcon size={17} /></span>
                    <input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} dir="ltr" placeholder="0000000000000" inputMode="numeric" />
                  </div>
                  <button className="btn ghost sm" type="button" onClick={scanning ? stopScan : startScan}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M3 12h18" /></svg>
                    {scanning ? 'إيقاف المسح' : 'مسح بالكاميرا'}
                  </button>
                  <label className="btn ghost sm" htmlFor="barcode-image">{decoding ? 'جارٍ القراءة…' : 'صورة باركود'}</label>
                  <input id="barcode-image" type="file" accept="image/*" capture="environment" hidden onChange={handleBarcodeImage} />
                </div>
                {scanning && (
                  <div className="scan-box">
                    <video ref={videoRef} className="scan-video" muted playsInline autoPlay />
                    <span className="scan-line" />
                  </div>
                )}
                {scanErr && <span className="scan-err">{scanErr}</span>}
              </div>

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
              <div className="field"><label>الوحدة</label><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></div>

              <div className="field"><label>تكلفة الوحدة (⃁)</label><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>حد التنبيه</label><input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} dir="ltr" /></div>

              <div className="field"><label>المورّد</label>
                <select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>إجمالي قيمة المخزون (⃁)</label>
                <div className="stock-value amt">{fmtMoney(formValue)} ⃁</div>
              </div>

              <div className="field span-2">
                <label>صورة المنتج</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="product-image">رفع صورة المنتج</label>
                  <input id="product-image" type="file" accept="image/*" hidden onChange={handleProductImage} />
                  {productImage.name && <span>{productImage.name}</span>}
                </div>
                {productImage.preview && <img className="upload-preview" src={productImage.preview} alt="صورة المنتج" />}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الصنف'}</button>
            </div>
          </form>
        </div>
      )}

      {inventorying && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeInventory()}>
          <form className="modal-card modal-sm" onSubmit={submitInventory}>
            <div className="modal-head">
              <div><h2>جرد الصنف</h2><p>{inventorying.name}</p></div>
              <button className="icon-close" type="button" onClick={closeInventory} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field"><label>الكمية الحالية</label><input type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(e) => setInventory('quantity', e.target.value)} dir="ltr" autoFocus /></div>
              <div className="field"><label>حد التنبيه</label><input type="number" min="0" step="0.01" value={inventoryForm.reorder_level} onChange={(e) => setInventory('reorder_level', e.target.value)} dir="ltr" /></div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={closeInventory} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الجرد'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
