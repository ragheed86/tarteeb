-- Prevent invoice payments from exceeding the invoice total.

create or replace function public.prevent_invoice_overpayment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice_total numeric(12,2);
  existing_paid numeric(12,2);
begin
  select total into invoice_total
  from public.invoices
  where id = new.invoice_id;

  if not found then
    raise exception 'invoice not found';
  end if;

  select coalesce(sum(amount), 0)
  into existing_paid
  from public.invoice_payments
  where invoice_id = new.invoice_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if existing_paid + new.amount > invoice_total then
    raise exception 'payment exceeds remaining invoice amount';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoice_payments_prevent_overpayment on public.invoice_payments;
create trigger trg_invoice_payments_prevent_overpayment
  before insert or update of amount, invoice_id on public.invoice_payments
  for each row execute function public.prevent_invoice_overpayment();
