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
  horas_semanales  numeric(5,2) not null default 10,
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
    new.precio_hora     := old.precio_hora;
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

-- =====================================================================
--  CLIENTES POR DÍA (versión 2): cada trabajador apunta los clientes
--  que ha hecho cada día y el tiempo dedicado a cada uno.
-- =====================================================================
alter table public.perfiles add column if not exists precio_hora numeric(6,2) not null default 8;

create table if not exists public.trabajos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  fecha       date not null,
  cliente     text not null check (length(trim(cliente)) between 1 and 80),
  minutos     integer not null check (minutos > 0 and minutos <= 960),
  nota        text not null default '',
  creado      timestamptz not null default now()
);
create index if not exists trabajos_usuario_fecha_idx on public.trabajos (usuario_id, fecha);
create index if not exists trabajos_fecha_idx on public.trabajos (fecha);

alter table public.trabajos enable row level security;
drop policy if exists trabajos_ver    on public.trabajos;
drop policy if exists trabajos_crear  on public.trabajos;
drop policy if exists trabajos_editar on public.trabajos;
drop policy if exists trabajos_borrar on public.trabajos;
create policy trabajos_ver    on public.trabajos for select
  using (usuario_id = auth.uid() or public.es_admin());
create policy trabajos_crear  on public.trabajos for insert
  with check ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());
create policy trabajos_editar on public.trabajos for update
  using ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin())
  with check ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());
create policy trabajos_borrar on public.trabajos for delete
  using ((usuario_id = auth.uid() and public.esta_activo()) or public.es_admin());

grant select, insert, update, delete on public.trabajos to authenticated;

-- =====================================================================
--  FICHA SEMANAL (versión 3): descuentos/anticipos, observaciones y
--  fecha de entrega de cada semana. Solo el master los escribe.
-- =====================================================================
create table if not exists public.descuentos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  lunes       date not null,
  concepto    text not null default '',
  importe     numeric(8,2) not null default 0,
  creado      timestamptz not null default now()
);
create index if not exists descuentos_usuario_lunes_idx on public.descuentos (usuario_id, lunes);

create table if not exists public.semanas (
  usuario_id     uuid not null references public.perfiles(id) on delete cascade,
  lunes          date not null,
  observaciones  text not null default '',
  entregado      date,
  primary key (usuario_id, lunes)
);

alter table public.descuentos enable row level security;
alter table public.semanas    enable row level security;

drop policy if exists descuentos_ver on public.descuentos;
drop policy if exists descuentos_master on public.descuentos;
create policy descuentos_ver    on public.descuentos for select using (usuario_id = auth.uid() or public.es_admin());
create policy descuentos_master on public.descuentos for all    using (public.es_admin()) with check (public.es_admin());

drop policy if exists semanas_ver on public.semanas;
drop policy if exists semanas_master on public.semanas;
create policy semanas_ver    on public.semanas for select using (usuario_id = auth.uid() or public.es_admin());
create policy semanas_master on public.semanas for all    using (public.es_admin()) with check (public.es_admin());

grant select, insert, update, delete on public.descuentos to authenticated;
grant select, insert, update, delete on public.semanas    to authenticated;

-- =====================================================================
--  CLIENTES (versión 4): lista de clientes que mantiene el master.
--  Las trabajadoras eligen el cliente de la lista y apuntan lo cobrado.
-- =====================================================================
create table if not exists public.clientes (
  id         bigint generated always as identity primary key,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  direccion  text not null default '',
  telefono   text not null default '',
  notas      text not null default '',
  activo     boolean not null default true,
  creado     timestamptz not null default now()
);
create unique index if not exists clientes_nombre_unico on public.clientes (lower(trim(nombre)));

alter table public.trabajos add column if not exists cliente_id bigint references public.clientes(id) on delete set null;
alter table public.trabajos add column if not exists cobrado numeric(8,2) not null default 0;
do $$ begin
  alter table public.trabajos add constraint trabajos_cobrado_ok check (cobrado >= 0 and cobrado <= 10000);
exception when duplicate_object then null; end $$;
create index if not exists trabajos_cliente_idx on public.trabajos (cliente_id, fecha);

-- Pasa los nombres ya escritos a la lista de clientes (solo la primera vez)
insert into public.clientes (nombre)
  select distinct on (lower(trim(cliente))) trim(cliente) from public.trabajos
  where cliente_id is null and length(trim(cliente)) > 0
  order by lower(trim(cliente)), trim(cliente)
on conflict do nothing;
update public.trabajos t set cliente_id = c.id
  from public.clientes c
  where t.cliente_id is null and lower(trim(t.cliente)) = lower(trim(c.nombre));

alter table public.clientes enable row level security;
drop policy if exists clientes_ver on public.clientes;
drop policy if exists clientes_master on public.clientes;
create policy clientes_ver    on public.clientes for select using (public.esta_activo());
create policy clientes_master on public.clientes for all    using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.clientes to authenticated;

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

-- =====================================================================
--  (versión 6) Solo el master puede modificar las fichas de las trabajadoras
-- =====================================================================
drop policy if exists perfiles_editar on public.perfiles;
create policy perfiles_editar on public.perfiles for update using (public.es_admin()) with check (public.es_admin());

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

-- =====================================================================
--  (versión 9) El master puede cambiar la contraseña de cualquier usuario
-- =====================================================================
create or replace function public.cambiar_contrasena(usuario uuid, nueva text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el master puede cambiar contraseñas';
  end if;
  if nueva is null or length(nueva) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nueva, extensions.gen_salt('bf')),
         updated_at = now()
   where id = usuario;
  if not found then
    raise exception 'Usuario no encontrado';
  end if;
end $$;
revoke all on function public.cambiar_contrasena(uuid, text) from public, anon;
grant execute on function public.cambiar_contrasena(uuid, text) to authenticated;

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
