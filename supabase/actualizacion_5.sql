-- ACTUALIZACIÓN 5: horas de contrato y precio por hora solo para el master (incluye la 4)

-- =====================================================================
--  (versión 8) Datos privados de cada trabajadora (horas de contrato y
--  precio por hora) solo visibles para el master. Se puede ejecutar varias veces.
-- =====================================================================
create table if not exists public.contratos (
  usuario_id       uuid primary key references public.perfiles(id) on delete cascade,
  horas_semanales  numeric(5,2) not null default 0 check (horas_semanales >= 0)
);
alter table public.contratos add column if not exists precio_hora numeric(6,2) not null default 8;
alter table public.contratos enable row level security;
drop policy if exists contratos_master on public.contratos;
create policy contratos_master on public.contratos for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.contratos to authenticated;

insert into public.contratos (usuario_id, horas_semanales, precio_hora)
  select id, horas_semanales, precio_hora from public.perfiles where horas_semanales > 0 or precio_hora > 0
on conflict (usuario_id) do update
  set horas_semanales = case when excluded.horas_semanales > 0 then excluded.horas_semanales else public.contratos.horas_semanales end,
      precio_hora     = case when excluded.precio_hora > 0 then excluded.precio_hora else public.contratos.precio_hora end;

alter table public.perfiles disable trigger proteger_perfil;
update public.perfiles set horas_semanales = 0, precio_hora = 0, dni = ''
  where horas_semanales <> 0 or precio_hora <> 0 or dni <> '';
alter table public.perfiles enable trigger proteger_perfil;
