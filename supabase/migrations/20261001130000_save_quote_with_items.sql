-- CRM-AUD-03 (+ numbering part of CRM-AUD-04): save a quote and its items in
-- one transaction. Previously the app updated the header, deleted the items and
-- re-inserted them as separate requests, so a failure in between could leave a
-- quote with no items; a failed create relied on a best-effort compensating
-- delete. Now everything commits together or nothing does.
--
-- * security invoker: the existing RLS on quotes/quote_items (has_permission +
--   can_write) still decides who can write; an explicit check gives a clear error.
-- * Optimistic locking: p_expected_updated_at must match the stored updated_at,
--   otherwise SQLSTATE 40001 is raised instead of silently overwriting someone
--   else's edit.
-- * Totals are recomputed here from the items, not trusted from the client.
-- * On create, a missing or already-used number is replaced with the next
--   Q-YYYY-NNN under an advisory lock, so two users can't collide on a number.

create or replace function public.save_quote_with_items(
  p_quote_id uuid,
  p_quote jsonb,
  p_items jsonb,
  p_default_vat_rate numeric default 15,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_quote_id;
  v_current_updated timestamptz;
  v_number text := nullif(trim(p_quote->>'number'), '');
  v_year text := to_char(coalesce((p_quote->>'issue_date')::date, current_date), 'YYYY');
  v_apply_vat boolean := coalesce((p_quote->>'apply_vat')::boolean, false);
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_vat numeric := 0;
  v_item jsonb;
  v_line numeric;
  v_disc numeric;
  v_qty numeric;
  v_price numeric;
begin
  if not ((select public.has_permission('quotes')) and (select public.can_write())) then
    raise exception 'لا تملك صلاحية تعديل عروض الأسعار' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'بنود العرض غير صالحة' using errcode = '22023';
  end if;

  -- Validate items and recompute totals.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_disc := coalesce((v_item->>'discount')::numeric, 0);
    if v_price < 0 or v_qty < 0 or v_disc < 0 then
      raise exception 'قيم البنود لا يمكن أن تكون سالبة' using errcode = '22023';
    end if;
    v_line := v_price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_discount := v_discount + v_disc;
    if v_apply_vat then
      v_vat := v_vat + (v_line - v_disc)
        * coalesce(nullif(v_item->>'vat_rate', '')::numeric, p_default_vat_rate, 15) / 100;
    end if;
  end loop;

  if v_id is null then
    -- Numbering: serialise number allocation per year.
    perform pg_advisory_xact_lock(hashtext('quote_number:' || v_year));
    if v_number is null or exists (select 1 from public.quotes q where q.number = v_number) then
      select 'Q-' || v_year || '-' || lpad((coalesce(max((substring(q.number from '-(\d+)$'))::int), 0) + 1)::text, 3, '0')
        into v_number
      from public.quotes q
      where q.number like 'Q-' || v_year || '-%';
    end if;

    insert into public.quotes (
      number, status, client_id, client_name, issue_date, description, terms_note, validity_note,
      validity_days, tools_show, tools_budget_min, tools_budget_max, rejection_reason, status_history,
      sent_at, accepted_at, rejected_at, subtotal, discount_total, total, apply_vat, created_by
    ) values (
      v_number,
      coalesce(p_quote->>'status', 'draft')::public.quote_status,
      nullif(p_quote->>'client_id', '')::uuid,
      nullif(p_quote->>'client_name', ''),
      coalesce((p_quote->>'issue_date')::date, current_date),
      nullif(p_quote->>'description', ''),
      nullif(p_quote->>'terms_note', ''),
      nullif(p_quote->>'validity_note', ''),
      coalesce((p_quote->>'validity_days')::int, 7),
      coalesce((p_quote->>'tools_show')::boolean, true),
      (p_quote->>'tools_budget_min')::numeric,
      (p_quote->>'tools_budget_max')::numeric,
      nullif(p_quote->>'rejection_reason', ''),
      coalesce(p_quote->'status_history', '[]'::jsonb),
      (p_quote->>'sent_at')::timestamptz,
      (p_quote->>'accepted_at')::timestamptz,
      (p_quote->>'rejected_at')::timestamptz,
      v_subtotal, v_discount, v_subtotal - v_discount + v_vat, v_apply_vat,
      (select auth.uid())
    )
    returning id into v_id;
  else
    select q.updated_at into v_current_updated from public.quotes q where q.id = v_id for update;
    if not found then
      raise exception 'عرض السعر غير موجود' using errcode = 'P0002';
    end if;
    if p_expected_updated_at is not null
       and date_trunc('milliseconds', v_current_updated) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'تم تعديل هذا العرض من مستخدم آخر — أعد فتحه قبل الحفظ' using errcode = '40001';
    end if;

    update public.quotes q set
      number = coalesce(v_number, q.number),
      status = coalesce(p_quote->>'status', 'draft')::public.quote_status,
      client_id = nullif(p_quote->>'client_id', '')::uuid,
      client_name = nullif(p_quote->>'client_name', ''),
      issue_date = coalesce((p_quote->>'issue_date')::date, q.issue_date),
      description = nullif(p_quote->>'description', ''),
      terms_note = nullif(p_quote->>'terms_note', ''),
      validity_note = nullif(p_quote->>'validity_note', ''),
      validity_days = coalesce((p_quote->>'validity_days')::int, 7),
      tools_show = coalesce((p_quote->>'tools_show')::boolean, true),
      tools_budget_min = (p_quote->>'tools_budget_min')::numeric,
      tools_budget_max = (p_quote->>'tools_budget_max')::numeric,
      rejection_reason = nullif(p_quote->>'rejection_reason', ''),
      status_history = coalesce(p_quote->'status_history', '[]'::jsonb),
      sent_at = (p_quote->>'sent_at')::timestamptz,
      accepted_at = (p_quote->>'accepted_at')::timestamptz,
      rejected_at = (p_quote->>'rejected_at')::timestamptz,
      subtotal = v_subtotal,
      discount_total = v_discount,
      total = v_subtotal - v_discount + v_vat,
      apply_vat = v_apply_vat
    where q.id = v_id;

    delete from public.quote_items qi where qi.quote_id = v_id;
  end if;

  insert into public.quote_items (quote_id, description, unit_price, qty, discount, vat_rate, sort_order)
  select v_id,
         coalesce(e.item->>'description', ''),
         coalesce((e.item->>'unit_price')::numeric, 0),
         coalesce((e.item->>'qty')::numeric, 0),
         coalesce((e.item->>'discount')::numeric, 0),
         nullif(e.item->>'vat_rate', '')::numeric,
         (e.ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);

  return v_id;
end;
$$;

revoke execute on function public.save_quote_with_items(uuid, jsonb, jsonb, numeric, timestamptz) from public, anon;
grant execute on function public.save_quote_with_items(uuid, jsonb, jsonb, numeric, timestamptz) to authenticated;
