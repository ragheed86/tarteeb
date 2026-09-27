-- 04 — اختبارات أمن الصلاحيات (RLS).
-- تتحقق أن نموذج read/write/delete يعمل: دور «المشاهدة فقط» (viewer) يقرأ ولا
-- يكتب/يحذف، والأدوار الأخرى (accountant/manager/...) تكتب، والمستخدم غير
-- الفعّال (inactive) لا يقرأ ولا يكتب، ولا يستطيع أحد تجاوز صلاحية الوحدة (BOLA).
--
-- التشغيل: psql "$DATABASE_URL" -f tests/rls_permissions_test.sql
-- كل التجهيزات داخل معاملة واحدة تُلغى في النهاية، فلا أثر دائم على البيانات.
-- عند أي فشل يُرفع استثناء فيخرج psql بحالة غير صفرية (مع ON_ERROR_STOP).

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_viewer   uuid := gen_random_uuid();
  v_manager  uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_client   uuid;
  n integer;
  blocked boolean;
begin
  -- تجهيزات: ثلاثة مستخدمين + عميل تجريبي (كصلاحية مميّزة، قبل الانتحال).
  insert into auth.users (id) values (v_viewer), (v_manager), (v_inactive);
  insert into public.app_user_access (user_id, email, role, permissions, active) values
    (v_viewer,   'rls-viewer@test.local',   'viewer',   array['clients'], true),
    (v_manager,  'rls-manager@test.local',  'manager',  array['clients'], true),
    (v_inactive, 'rls-inactive@test.local', 'manager',  array['clients'], false);
  insert into public.clients (name) values ('RLS FIXTURE CLIENT') returning id into v_client;

  ------------------------------------------------------------------
  -- viewer: يقرأ فقط
  ------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);

  -- (1) القراءة مسموحة: يرى العميل المجهّز
  select count(*) into n from public.clients where id = v_client;
  if n <> 1 then raise exception 'FAIL[viewer-read]: expected to read fixture client, got %', n; end if;

  -- (2) الإدخال ممنوع
  blocked := false;
  begin
    insert into public.clients (name) values ('viewer insert should fail');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL[viewer-insert]: viewer was able to INSERT'; end if;

  -- (3) التعديل لا يؤثر على أي صف (RLS يحجبه)
  update public.clients set name = 'hacked' where id = v_client;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL[viewer-update]: viewer UPDATE affected % rows', n; end if;

  -- (4) الحذف لا يؤثر على أي صف
  delete from public.clients where id = v_client;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL[viewer-delete]: viewer DELETE affected % rows', n; end if;

  ------------------------------------------------------------------
  -- manager: يكتب
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    insert into public.clients (name) values ('manager insert ok');
  exception when others then blocked := true;
  end;
  if blocked then raise exception 'FAIL[manager-insert]: manager could not INSERT'; end if;

  -- تعديل المدير ينجح ويؤثر على الصف
  update public.clients set name = 'manager updated' where id = v_client;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL[manager-update]: manager UPDATE affected % rows', n; end if;

  ------------------------------------------------------------------
  -- inactive: لا يقرأ ولا يكتب
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_inactive::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.clients where id = v_client;
  if n <> 0 then raise exception 'FAIL[inactive-read]: inactive user read % rows (expected 0)', n; end if;

  blocked := false;
  begin
    insert into public.clients (name) values ('inactive insert should fail');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL[inactive-insert]: inactive user was able to INSERT'; end if;

  ------------------------------------------------------------------
  -- BOLA: مستخدم بلا صلاحية الوحدة لا يصل إليها إطلاقاً
  ------------------------------------------------------------------
  -- المدير يملك clients فقط، فلا يستطيع القراءة من invoices
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    insert into public.invoices (client_id) values (v_client);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL[bola-insert]: user without invoices permission inserted an invoice'; end if;

  reset role;
  raise notice 'ALL RLS PERMISSION TESTS PASSED';
end $$;

rollback;
