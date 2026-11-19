# Control de horas

App web para registrar las horas del equipo.

- **Tú (master)** creas los usuarios, ves y corriges las horas de todos y sacas los **informes semanales de lunes a domingo**.
- **Cada trabajador** entra con su usuario y contraseña, ve **solo sus horas** y su ficha, y apunta cada día en un **calendario de lunes a domingo** que siempre abre en el mes actual.
- Cada día se apunta como: Trabajado (turno 1 y, si hace jornada partida, turno 2, más el descanso), Vacaciones, Festivo, Baja o Ausencia. La app calcula el total.
- El informe muestra una tabla por persona con columnas `lun 16 · mar 17 · … · dom 22`, el total, las horas de contrato y la diferencia, el detalle de entradas y salidas, y las últimas 8 semanas. Se puede descargar para Excel o imprimir en PDF (A4 horizontal).

Funciona con **Supabase** (base de datos y usuarios, plan gratuito) y **GitHub Pages** (publicar la web, gratis).

---

## Puesta en marcha (unos 10 minutos)

### 1. Crea la base de datos en Supabase
1. Entra en <https://supabase.com>, crea una cuenta y pulsa **New project** (región: *West EU*). Guarda la contraseña que te pida.
2. Cuando esté listo, ve a **SQL Editor → New query**, pega **todo** el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Debe decir *Success*.
3. Ve a **Authentication → Sign In / Providers → Email** y **desactiva «Confirm email»**. Guarda.
   *(Los usuarios entran con nombre de usuario, no con un email real, así que no hay nada que confirmar.)*
4. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public key**

### 2. Pon esos datos en la app
Edita [`config.js`](config.js) aquí en GitHub (icono del lápiz) y sustituye:

```js
SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
SUPABASE_ANON_KEY: "TU-ANON-KEY",
```

Pulsa **Commit changes**. La anon key puede estar en un repositorio público: la seguridad la ponen las reglas de la base de datos.

### 3. Publica la web con GitHub Pages
En el repositorio: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
Al minuto tendrás la app en `https://motorama2027.github.io/horas/`.

### 4. Crea tu cuenta master
Abre la web. Como aún no hay usuarios, te pedirá **crear la cuenta master**: elige tu usuario y contraseña. Esa primera cuenta es la única con acceso a todo.

### 5. Da de alta a tu equipo
Menú **Usuarios → + Nuevo usuario**: usuario, contraseña inicial, nombre, puesto y horas semanales de contrato. Pásale a cada persona la dirección de la web, su usuario y su contraseña. Desde **Mi ficha** pueden cambiar la contraseña y sus datos de contacto.

---

## Uso diario

| Quién | Qué hace |
|---|---|
| Trabajador | **Calendario** → pulsa el día → entrada/salida (y turno de tarde si tiene) → Guardar. Ve su total semanal a la derecha de cada semana. |
| Master | **Calendario** → elige la persona en el desplegable para ver o corregir sus horas. |
| Master | **Informes semanales** → «Semana pasada» para el informe de lunes a domingo cerrado. Flechas para ir a otras semanas. «Descargar Excel» o «Imprimir / PDF». |
| Master | **Usuarios** → pulsa una fila para editar la ficha, desactivar a alguien (no puede entrar pero conserva su historial) o hacerlo master. |

## Preguntas frecuentes

**Un trabajador ha olvidado la contraseña.** En Supabase → *SQL Editor* ejecuta (cambia el usuario y la contraseña):

```sql
update auth.users
set encrypted_password = crypt('NuevaClave123', gen_salt('bf'))
where email = 'laura.g@equipo.horas.app';
```

**Quiero borrar del todo a alguien.** Desactívalo desde la app (recomendado, conserva sus horas). Para borrarlo por completo: Supabase → *Authentication → Users* → borrar; se eliminan también su ficha y sus horas.

**¿Dónde se guardan los datos?** En tu proyecto de Supabase (servidores en la UE si eliges *West EU*). Puedes exportarlos desde *Table Editor → registros → Export CSV*.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app (HTML + JavaScript, sin instalar nada) |
| `config.js` | Tus claves de Supabase y el nombre de la empresa |
| `supabase/schema.sql` | Tablas y reglas de seguridad |
