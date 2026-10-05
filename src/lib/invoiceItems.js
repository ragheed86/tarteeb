// ============================================================
//  بند "منظمات وأدوات الترتيب" في الفواتير — تصنيف ثابت ومشترك
//  بين صفحة الفواتير وصفحة تفاصيل المشروع (لحساب ربح المنظمات).
// ============================================================
export const ORGANIZERS_ITEM = 'منظمات و ادوات الترتيب والتخزين';

export function isOrganizersItem(description) {
  const value = String(description || '').trim();
  return value === ORGANIZERS_ITEM || value === 'ادوات ترتيب و منظمات';
}

export function unitForDescription(description) {
  return isOrganizersItem(description) ? 'مجموعة' : 'غرفة';
}

// ربح بند منظمات واحد = (سعر البيع − السعر الداخلي) × الكمية؛ 0 إن لم يكن بند منظمات
// أو لم يُسجَّل سعر داخلي له بعد.
export function organizersItemProfit(item) {
  if (!isOrganizersItem(item?.description)) return 0;
  const qty = Number(item?.qty) || 0;
  const unitPrice = Number(item?.unit_price) || 0;
  const base = Number(item?.internal_base_price) || 0;
  return (unitPrice - base) * qty;
}

export function organizersProfitFromItems(items) {
  return (items || []).reduce((sum, item) => sum + organizersItemProfit(item), 0);
}
