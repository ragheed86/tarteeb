-- أعمدة إحالة حقيقية بدل تخزين «مصدر الإحالة» نصاً داخل notes
-- (لا ترحيل بيانات: وقت التطبيق كانت 0 من 31 عميلاً تحمل سطر إحالة في الملاحظات)
alter table public.clients
  add column if not exists referred_by_client_id uuid references public.clients(id) on delete set null,
  add column if not exists referred_by_employee_id uuid references public.employees(id) on delete set null;
