-- ACTUALIZACIÓN 7: precios a clientes (extracto mensual)

-- =====================================================================
--  (versión 10) Precios a clientes para el extracto mensual.
--  Precio general por hora (tabla ajustes) + precio propio opcional por cliente (tabla tarifas).
--  Solo el master puede verlos o cambiarlos.
-- =====================================================================
create table if not exists public.ajustes (
  clave  text primary key,
  valor  text not null default ''
);
alter table public.ajustes enable row level security;
drop policy if exists ajustes_master on public.ajustes;
create policy ajustes_master on public.ajustes for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.ajustes to authenticated;

create table if not exists public.tarifas (
  cliente_id  bigint primary key references public.clientes(id) on delete cascade,
  tipo        text not null default 'hora' check (tipo in ('hora','servicio')),
  importe     numeric(8,2) not null default 0 check (importe >= 0)
);
alter table public.tarifas enable row level security;
drop policy if exists tarifas_master on public.tarifas;
create policy tarifas_master on public.tarifas for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.tarifas to authenticated;
