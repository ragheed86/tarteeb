-- يثبّت search_path على الدالة المشتركة set_updated_at لإغلاق تحذير Supabase الأمني الأخير
-- (function_search_path_mutable) بعد أن أُصلحت بقية الدوال في 0005.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;
