-- ACTUALIZACIÓN 2: tarifas por cliente (para facturar)

-- =====================================================================
--  TARIFAS POR CLIENTE (versión 5): lo que se factura a cada cliente.
--  Solo el master puede verlas o cambiarlas.
-- =====================================================================
create table if not exists public.tarifas (
  cliente_id  bigint primary key references public.clientes(id) on delete cascade,
  tipo        text not null default 'hora' check (tipo in ('hora','servicio')),
  importe     numeric(8,2) not null default 0 check (importe >= 0)
);
alter table public.tarifas enable row level security;
drop policy if exists tarifas_master on public.tarifas;
create policy tarifas_master on public.tarifas for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.tarifas to authenticated;
