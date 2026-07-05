update public.app_user_access
set permissions = (
  select array_agg(distinct permission order by permission)
  from unnest(permissions || array['warehouse_inventory', 'warehouse_products']::text[]) as permission
),
updated_at = now()
where permissions @> array['warehouse']::text[];
