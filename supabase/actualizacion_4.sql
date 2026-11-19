-- ACTUALIZACIÓN 4: horas de contrato solo para el master y fuera el DNI

-- =====================================================================
--  (versión 7) Horas de contrato en una tabla que solo ve el master.
--  Se borran el DNI y las horas de la tabla de perfiles (que cada trabajadora puede leer).
-- =====================================================================
create table if not exists public.contratos (
  usuario_id       uuid primary key references public.perfiles(id) on delete cascade,
  horas_semanales  numeric(5,2) not null default 0 check (horas_semanales >= 0)
);
alter table public.contratos enable row level security;
drop policy if exists contratos_master on public.contratos;
create policy contratos_master on public.contratos for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.contratos to authenticated;

insert into public.contratos (usuario_id, horas_semanales)
  select id, horas_semanales from public.perfiles where horas_semanales > 0
on conflict (usuario_id) do nothing;
alter table public.perfiles disable trigger proteger_perfil;
update public.perfiles set horas_semanales = 0, dni = '' where horas_semanales <> 0 or dni <> '';
alter table public.perfiles enable trigger proteger_perfil;
