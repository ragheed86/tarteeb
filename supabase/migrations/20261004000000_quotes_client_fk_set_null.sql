-- quotes.client_id was created with `on delete restrict`, which blocks deleting a
-- client that has any saved quote. Every other FK pointing at clients.id uses
-- cascade/set null; align quotes with invoices (set null) so a client can be
-- removed while its quotes remain as historical records with no linked client.
alter table public.quotes drop constraint if exists quotes_client_id_fkey;
alter table public.quotes
  add constraint quotes_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;
