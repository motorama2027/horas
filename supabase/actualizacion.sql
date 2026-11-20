-- ACTUALIZACIÓN: clientes, trabajos, cobros, anticipos y precio por hora
-- =====================================================================
--  CLIENTES POR DÍA (versión 2): cada trabajador apunta los clientes
--  que ha hecho cada día y el tiempo dedicado a cada uno.
-- =====================================================================
alter table public.perfiles add column if not exists precio_hora numeric(6,2) not null default 8;

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
