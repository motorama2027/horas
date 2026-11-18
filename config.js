// =====================================================================
//  CONFIGURACIÓN · Rellena estos dos datos con los de tu proyecto Supabase
//  (Supabase → Project Settings → API). La "anon public key" es pública:
//  la seguridad la ponen las reglas de schema.sql, no esta clave.
// =====================================================================
window.CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU-ANON-KEY",

  // Nombre que aparece arriba en la app
  EMPRESA: "Motorama",

  // Los usuarios entran con "usuario + contraseña". Por dentro Supabase
  // necesita un email, así que se genera usuario@ESTE_DOMINIO (no se envía nada).
  DOMINIO_USUARIOS: "equipo.motorama.app",
};
