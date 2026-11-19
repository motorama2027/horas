-- =====================================================================
--  CONTROL DE HORAS · Esquema de base de datos para Supabase
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.perfiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  usuario          text unique not null,
  nombre           text not null default '',
  apellidos        text not null default '',
  dni              text not null default '',
  telefono         text not null default '',
  email_contacto   text not null default '',
  direccion        text not null default '',
  puesto           text not null default '',
  horas_semanales  numeric(5,2) not null default 40,
  fecha_alta       date not null default current_date,
  notas            text not null default '',
  es_admin         boolean not null default false,
  activo           boolean not null default false,
  creado_en        timestamptz not null default now()
);

create table if not exists public.registros (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references public.perfiles(id) on delete cascade,
  fecha        date not null,
  tipo         text not null default 'trabajo'
               check (tipo in ('trabajo','vacaciones','festivo','baja','ausencia')),
  entrada1     time,
  salida1      time,
  entrada2     time,
  salida2      time,
  pausa_min    integer not null default 0 check (pausa_min >= 0),
  horas        numeric(5,2) not null default 0 check (horas >= 0 and horas <= 24),
  nota         text not null default '',
  actualizado  timestamptz not null default now(),
  unique (usuario_id, fecha)
);

create index if not exists registros_fecha_idx on public.registros (fecha);

-- ---------- Funciones auxiliares ----------
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin and activo from perfiles where id = auth.uid()), false);
$$;

create or replace function public.esta_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select activo from perfiles where id = auth.uid()), false);
$$;

-- Permite a la pantalla de login saber si aún no existe ningún usuario
create or replace function public.hay_usuarios()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles);
$$;
grant execute on function public.hay_usuarios() to anon, authenticated;

-- Al crear una cuenta se crea su ficha. La PRIMERA cuenta es el master (admin).
-- El resto nacen inactivas hasta que el master las activa desde la app.
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  primero boolean;
begin
  select not exists (select 1 from perfiles) into primero;
  insert into perfiles (id, usuario, nombre, es_admin, activo)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'usuario', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    primero,
    primero
  );
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Un trabajador solo puede cambiar sus datos de contacto, nunca su puesto,
-- horas, estado o permisos.
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then
    new.usuario         := old.usuario;
    new.nombre          := old.nombre;
    new.apellidos       := old.apellidos;
    new.dni             := old.dni;
    new.puesto          := old.puesto;
    new.horas_semanales := old.horas_semanales;
    new.fecha_alta      := old.fecha_alta;
    new.notas           := old.notas;
    new.es_admin        := old.es_admin;
    new.activo          := old.activo;
  end if;
  return new;
end $$;

drop trigger if exists proteger_perfil on public.perfiles;
create trigger proteger_perfil
  before update on public.perfiles
  for each row execute function public.proteger_perfil();

create or replace function public.marcar_actualizado()
returns trigger language plpgsql as $$
begin new.actualizado := now(); return new; end $$;

drop trigger if exists marcar_actualizado on public.registros;
create trigger marcar_actualizado
  before update on public.registros
  for each row execute function public.marcar_actualizado();

-- ---------- Seguridad (cada uno ve solo lo suyo, el master lo ve todo) ----------
alter table public.perfiles  enable row level security;
alter table public.registros enable row level security;

drop policy if exists perfiles_ver       on public.perfiles;
drop policy if exists perfiles_editar    on public.perfiles;
drop policy if exists perfiles_borrar    on public.perfiles;
create policy perfiles_ver    on public.perfiles for select using (id = auth.uid() or public.es_admin());
create policy perfiles_editar on public.perfiles for update using (id = auth.uid() or public.es_admin());
create policy perfiles_borrar on public.perfiles for delete using (public.es_admin() and id <> auth.uid());

drop policy if exists registros_ver      on public.registros;
drop policy if exists registros_crear    on public.registros;
drop policy if exists registros_editar   on public.registros;
drop policy if exists registros_borrar   on public.registros;
create policy registros_ver    on public.registros for select
  using (usuario_id = auth.uid() or public.es_admin());
create policy registros_crear  on public.registros for insert
  with check ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());
create policy registros_editar on public.registros for update
  using ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin())
  with check ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());
create policy registros_borrar on public.registros for delete
  using ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());

-- ---------- Permisos de acceso a las tablas (las reglas de arriba deciden qué filas ve cada uno) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.perfiles  to authenticated;
grant select, insert, update, delete on public.registros to authenticated;
grant execute on function public.es_admin(), public.esta_activo() to authenticated;
