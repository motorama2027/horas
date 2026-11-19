-- ACTUALIZACIÓN 3: solo el master modifica las fichas

-- =====================================================================
--  (versión 6) Solo el master puede modificar las fichas de las trabajadoras
-- =====================================================================
drop policy if exists perfiles_editar on public.perfiles;
create policy perfiles_editar on public.perfiles for update using (public.es_admin()) with check (public.es_admin());
