-- ACTUALIZACIÓN 6: el master puede cambiar contraseñas

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
