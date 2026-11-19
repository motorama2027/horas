# Control de horas

App web para registrar las horas del equipo.

- **Tú (master)** creas los usuarios, ves y corriges las horas de todos y sacas los **informes semanales de lunes a domingo**.
- **Cada trabajador** entra con su usuario y contraseña, ve **solo sus horas** y su ficha, y apunta **semana a semana (lunes a domingo)** los clientes que ha hecho cada día y el tiempo de cada uno (ej. *Dolores 2 h 30 min · Peluquería 1 h · Escalera Sant Pere 45 min*).
- Cuentas de cada semana: **horas hechas − horas de contrato = horas extra × precio por hora** de esa persona (cada trabajador tiene su propio precio, editable en su ficha).
- El informe semanal muestra una tabla por persona (`lun 16 · mar 17 · … · dom 22`, total, contrato, extra, €/hora e importe), la ficha de cada persona con sus clientes día a día (descargable en Excel o imprimible en PDF, A4 horizontal), las horas por cliente y las últimas 8 semanas.

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

### 5. Carga tus clientes
En **SQL Editor** pega [`supabase/clientes_inicial.sql`](supabase/clientes_inicial.sql) y pulsa **Run** (54 clientes de la hoja). Luego, en la app, sección **Clientes**, completa la dirección y el teléfono de cada uno, o añade más con **+ Nuevo cliente** o **Pegar lista**.

### 6. Da de alta a tu equipo
Menú **Usuarios → + Nuevo usuario**: usuario, contraseña inicial, nombre, horas de contrato por semana y precio por hora. Pásale a cada persona la dirección de la web, su usuario y su contraseña. Desde **Mi ficha** pueden cambiar la contraseña y sus datos de contacto.

---

## Uso diario

| Quién | Qué hace |
|---|---|
| Trabajador | **Calendario** → en cada día escribe el cliente y el tiempo; **+ Añadir cliente** para el siguiente. Se guarda solo. Arriba ve sus horas, el contrato, las extras y el importe. |
| Master | **Calendario** → elige la persona en el desplegable para ver o corregir sus horas. |
| Master | **Informes semanales** → «Semana pasada» para el informe de lunes a domingo cerrado. Flechas para ir a otras semanas. «Descargar Excel» o «Imprimir / PDF». |
| Master | **Clientes** → ficha de cada cliente, horas y visitas del mes, lo cobrado y quién ha ido. «Descargar Excel del mes». |
| Master | **Informes semanales** → en la ficha de cada una: anticipos, observaciones y fecha de entrega. **Descargar Excel** → hoja vertical por semana (salmón/verde alternando), como la de papel. |
| Master | **Usuarios** → pulsa una fila para editar la ficha, desactivar a alguien (no puede entrar pero conserva su historial) o hacerlo master. |

## Actualizar la base de datos

Si cambia `supabase/schema.sql`, vuelve a pegarlo entero en **SQL Editor** y pulsa **Run**. Se puede ejecutar las veces que haga falta: no borra datos.

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
