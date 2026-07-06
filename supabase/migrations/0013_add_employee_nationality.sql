-- إضافة عمود جنسية الموظف
alter table public.employees add column if not exists nationality text;
