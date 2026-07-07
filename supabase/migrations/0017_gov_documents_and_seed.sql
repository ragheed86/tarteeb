-- عمود مستند الجهة + حاوية تخزين gov-documents + تعبئة الجهات الاثنتي عشرة
alter table public.government_accounts add column if not exists doc_url text;

insert into storage.buckets (id, name, public)
values ('gov-documents', 'gov-documents', true)
on conflict (id) do nothing;

create policy gov_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'gov-documents' and (select has_permission('government')));
create policy gov_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gov-documents' and (select has_permission('government')));
create policy gov_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gov-documents' and (select has_permission('government')));

insert into public.government_accounts (entity_name, login_url, status)
select v.entity_name, v.login_url, 'incomplete'::gov_status
from (values
  ('البنك', null),
  ('بلدي', 'https://balady.gov.sa'),
  ('قوى', 'https://qiwa.sa'),
  ('أبشر أعمال', 'https://www.absher.sa'),
  ('وزارة الموارد البشرية', 'https://www.hrsd.gov.sa'),
  ('مقيم', 'https://muqeem.sa'),
  ('الدفاع المدني (سلامة)', 'https://salamah.998.gov.sa'),
  ('هيئة الزكاة والضريبة والجمارك', 'https://zatca.gov.sa'),
  ('البريد السعودي (سبل)', 'https://splonline.com.sa'),
  ('التأمينات الاجتماعية', 'https://www.gosi.gov.sa'),
  ('الغرفة التجارية', 'https://chamber.sa'),
  ('وزارة التجارة', 'https://mc.gov.sa')
) as v(entity_name, login_url)
where not exists (select 1 from public.government_accounts g where g.entity_name = v.entity_name);
