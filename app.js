/* =====================================================================
   CONTROL DE HORAS · lógica de la app
   ===================================================================== */
(() => {
  "use strict";

  const C = window.CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);

  const configurado = C.SUPABASE_URL && !C.SUPABASE_URL.includes("TU-PROYECTO") && C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.includes("TU-ANON");
  if (!configurado) {
    document.body.innerHTML = `<div class="login"><div class="login-card"><h1>Falta configurar</h1>
      <p class="muted">Abre <b>config.js</b> y pega la URL y la anon key de tu proyecto Supabase. Los pasos están en el README.</p></div></div>`;
    return;
  }

  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  // Cliente aparte para crear usuarios sin cerrar la sesión del master
  const sbAlta = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "horas-alta" },
  });

  const TIPOS = {
    trabajo: "Trabajado",
    vacaciones: "Vacaciones",
    festivo: "Festivo",
    baja: "Baja",
    ausencia: "Ausencia",
  };
  const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  const estado = {
    yo: null,              // perfil del usuario conectado
    perfiles: [],          // (admin) todos los perfiles
    vista: "calendario",
    calUsuario: null,      // id del usuario mostrado en el calendario
    calLunes: lunesDe(new Date()),
    infLunes: lunesDe(new Date()),
    registrosMes: new Map(),
    clientes: [],
    cliMes: inicioMes(new Date()),
  };

  // ---------------------------------------------------------------- utilidades de fecha
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function deYmd(s) { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); }
  function sumarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function lunesDe(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return sumarDias(x, -((x.getDay() + 6) % 7)); }
  function inicioMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function esFinde(d) { return d.getDay() === 0 || d.getDay() === 6; }
  function diaCorto(d) { return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()}`; }
  function fechaLarga(d) {
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    return `${dias[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} ${d.getFullYear()}`;
  }
  function rangoSemana(lunes) {
    const dom = sumarDias(lunes, 6);
    const m1 = MESES[lunes.getMonth()], m2 = MESES[dom.getMonth()];
    return lunes.getMonth() === dom.getMonth()
      ? `Lunes ${lunes.getDate()} – domingo ${dom.getDate()} de ${m2} ${dom.getFullYear()}`
      : `Lunes ${lunes.getDate()} de ${m1} – domingo ${dom.getDate()} de ${m2} ${dom.getFullYear()}`;
  }
  function numSemana(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia);
    const ini = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - ini) / 86400000 + 1) / 7);
  }

  // ---------------------------------------------------------------- utilidades de horas
  function minutos(t) { if (!t) return null; const [h, m] = t.slice(0, 5).split(":").map(Number); return h * 60 + m; }
  function duracion(e, s) {
    const a = minutos(e), b = minutos(s);
    if (a == null || b == null) return 0;
    return b >= a ? b - a : b + 1440 - a; // admite turnos que pasan de medianoche
  }
  function calcularHoras(r) {
    if (r.tipo !== "trabajo") return 0;
    const total = duracion(r.entrada1, r.salida1) + duracion(r.entrada2, r.salida2) - (Number(r.pausa_min) || 0);
    return Math.max(0, Math.round((total / 60) * 100) / 100);
  }
  function fmtH(h) {
    const n = Number(h) || 0;
    const neg = n < 0, a = Math.abs(n);
    const hh = Math.floor(a), mm = Math.round((a - hh) * 60);
    const [H, M] = mm === 60 ? [hh + 1, 0] : [hh, mm];
    return `${neg ? "−" : ""}${H}:${String(M).padStart(2, "0")}`;
  }
  function fmtDec(h) { return (Math.round((Number(h) || 0) * 100) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hm(t) { return t ? t.slice(0, 5) : ""; }
  function tramosTxt(r) {
    if (!r || r.tipo !== "trabajo") return "";
    const p = [];
    if (r.entrada1 && r.salida1) p.push(`${hm(r.entrada1)}–${hm(r.salida1)}`);
    if (r.entrada2 && r.salida2) p.push(`${hm(r.entrada2)}–${hm(r.salida2)}`);
    return p.join(" · ");
  }

  // ---------------------------------------------------------------- utilidades de UI
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function nombreDe(p) { return p ? `${p.nombre || ""} ${p.apellidos || ""}`.trim() || p.usuario : "—"; }
  let tAviso;
  function aviso(txt, mal = false) {
    const el = $("#aviso");
    el.textContent = txt; el.classList.toggle("mal", mal); el.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => (el.hidden = true), 3200);
  }
  function errorTxt(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
    if (/Email not confirmed/i.test(m)) return "Supabase pide confirmar el email: desactiva «Confirm email» en Authentication → Sign In / Providers → Email, borra el usuario en Authentication → Users y créalo de nuevo.";
    if (/Database error saving new user/i.test(m)) return "Supabase no pudo crear la ficha del usuario. Vuelve a ejecutar schema.sql completo en el SQL Editor.";
    if (/already registered|already exists|duplicate key.*usuario/i.test(m)) return "Ese nombre de usuario ya existe.";
    if (/Password should be at least/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
    if (/row-level security/i.test(m)) return "No tienes permiso para hacer esto. ¿Tu usuario está activo?";
    if (/rate limit/i.test(m)) return "Demasiados intentos seguidos. Espera unos minutos.";
    return m;
  }
  function abrirModal(titulo, html) {
    $("#modal .modal-caja").classList.remove("modal-ancha");
    $("#modal-titulo").textContent = titulo;
    $("#modal-cuerpo").innerHTML = html;
    $("#modal").hidden = false;
    const f = $("#modal-cuerpo input:not([readonly]), #modal-cuerpo select");
    if (f) setTimeout(() => f.focus(), 30);
  }
  function cerrarModal() { $("#modal").hidden = true; $("#modal-cuerpo").innerHTML = ""; $("#modal .modal-caja").classList.remove("modal-ancha"); }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-cerrar]")) cerrarModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) cerrarModal(); });

  const emailDe = (usuario) => `${usuario.toLowerCase().trim()}@${C.DOMINIO_USUARIOS}`;
  const usuarioValido = (u) => /^[a-z0-9._-]{3,30}$/.test(u);

  // ================================================================ LOGIN
  let modoAlta = false;

  async function mostrarLogin() {
    $("#vista-app").hidden = true;
    $("#vista-login").hidden = false;
    $("#login-empresa").textContent = C.EMPRESA || "Control de horas";
    const { data: hay, error: eHay } = await sb.rpc("hay_usuarios");
    modoAlta = hay === false;
    if (eHay) {
      console.error("hay_usuarios", eHay);
      $("#login-error").textContent = `No se puede conectar con la base de datos: ${eHay.message}. Revisa config.js y que schema.sql se ejecutó.`;
    }
    $("#login-titulo").textContent = modoAlta ? "Crear cuenta master" : "Entrar";
    $("#login-sub").textContent = modoAlta
      ? "Aún no hay ningún usuario. Esta primera cuenta será la del administrador (master), que verá las horas de todos."
      : "Introduce el usuario y la contraseña que te ha dado tu responsable.";
    $("#login-nombre-wrap").hidden = !modoAlta;
    $("#login-btn").textContent = modoAlta ? "Crear cuenta master" : "Entrar";
    $("#login-pass").autocomplete = modoAlta ? "new-password" : "current-password";
    $("#login-usuario").focus();
  }

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = $("#login-usuario").value.toLowerCase().trim();
    const pass = $("#login-pass").value;
    const btn = $("#login-btn");
    $("#login-error").textContent = "";
    btn.disabled = true;
    try {
      if (modoAlta) {
        if (!usuarioValido(usuario)) throw new Error("El usuario solo puede tener letras minúsculas, números, punto, guion o guion bajo (3 a 30).");
        const { error } = await sb.auth.signUp({
          email: emailDe(usuario), password: pass,
          options: { data: { usuario, nombre: $("#login-nombre").value.trim() } },
        });
        if (error) throw error;
        const { data: s } = await sb.auth.getSession();
        if (!s.session) {
          const { error: e2 } = await sb.auth.signInWithPassword({ email: emailDe(usuario), password: pass });
          if (e2) throw e2;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: emailDe(usuario), password: pass });
        if (error) throw error;
      }
      await arrancar();
    } catch (err) {
      console.error("Login", err);
      $("#login-error").textContent = errorTxt(err);
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-salir").addEventListener("click", async () => {
    await sb.auth.signOut();
    estado.yo = null;
    mostrarLogin();
  });

  // ================================================================ ARRANQUE
  async function arrancar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarLogin();

    const { data: yo, error } = await sb.from("perfiles").select("*").eq("id", session.user.id).maybeSingle();
    if (error || !yo) {
      console.error("Error al leer el perfil", error);
      await sb.auth.signOut();
      await mostrarLogin();
      $("#login-error").textContent = error
        ? `La sesión se abrió pero no se pudo leer tu ficha: ${error.message}${error.code ? " (" + error.code + ")" : ""}`
        : "La sesión se abrió pero tu ficha no existe en la tabla «perfiles». Vuelve a ejecutar schema.sql en Supabase.";
      return;
    }
    if (!yo.activo) {
      await sb.auth.signOut();
      await mostrarLogin();
      $("#login-error").textContent = "Tu usuario está desactivado. Habla con tu responsable.";
      return;
    }
    estado.yo = yo;
    estado.calUsuario = yo.id;
    if (yo.es_admin) await cargarPerfiles();

    $("#vista-login").hidden = true;
    $("#vista-app").hidden = false;
    $("#cab-empresa").textContent = C.EMPRESA || "Control de horas";
    $("#cab-nombre").textContent = nombreDe(yo) + (yo.es_admin ? " · master" : "");
    pintarNav();
    irA(location.hash.slice(1) || "calendario");
  }

  async function cargarPerfiles() {
    const { data, error } = await sb.from("perfiles").select("*").order("nombre");
    if (error) return aviso(errorTxt(error), true);
    estado.perfiles = data;
  }

  function secciones() {
    const s = [["calendario", "Calendario"], ["ficha", "Mi ficha"]];
    if (estado.yo?.es_admin) s.push(["clientes", "Clientes"], ["usuarios", "Usuarios"], ["informes", "Informes semanales"]);
    return s;
  }
  function pintarNav() {
    $("#nav").innerHTML = secciones().map(([k, t]) => `<a href="#${k}" data-vista="${k}">${t}</a>`).join("");
  }
  window.addEventListener("hashchange", () => estado.yo && irA(location.hash.slice(1)));

  function irA(v) {
    if (!secciones().some(([k]) => k === v)) v = "calendario";
    estado.vista = v;
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("activo", a.dataset.vista === v));
    ({ calendario: vistaCalendario, ficha: vistaFicha, clientes: vistaClientes, usuarios: vistaUsuarios, informes: vistaInformes })[v]();
  }

  // ================================================================ SEMANA (L–D) · clientes por día
  const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const eur = (n) => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const fmtMin = (m) => fmtH((Number(m) || 0) / 60);
  const num2 = (n) => (Number(n) || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 });

  // Cuentas de la semana:
  //   horas extra = horas hechas − horas de contrato
  //   importe     = horas extra × precio por hora
  //   a pagar     = importe − lo cobrado en las casas − anticipos
  function cuentas(minutos, p, cobrado = 0, anticipos = 0) {
    const horas = (Number(minutos) || 0) / 60;
    const contrato = Number(p.horas_semanales) || 0;
    const precio = Number(p.precio_hora) || 0;
    const dif = horas - contrato;
    const extra = Math.max(0, dif);
    const r2 = (x) => Math.round(x * 100) / 100;
    const bruto = r2(horas * precio);
    const importe = r2(extra * precio);
    const descuentos = r2((Number(cobrado) || 0) + (Number(anticipos) || 0));
    return { horas, contrato, precio, dif, extra, faltan: Math.max(0, -dif), bruto, importe, cobrado: Number(cobrado) || 0, anticipos: Number(anticipos) || 0, descuentos, apagar: r2(importe - descuentos) };
  }

  async function cargarListaClientes() {
    const { data, error } = await sb.from("clientes").select("*").order("nombre");
    if (!error) estado.clientes = data.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  }
  const clientePorId = (id) => estado.clientes.find((c) => String(c.id) === String(id));
  const nombreCliente = (t) => clientePorId(t.cliente_id)?.nombre || t.cliente;

  async function vistaCalendario() {
    const yo = estado.yo;
    await cargarListaClientes();
    const activos = estado.perfiles.filter((p) => p.activo);
    const selector = yo.es_admin
      ? `<select id="cal-usuario" aria-label="Persona">${activos.map((p) => `<option value="${p.id}" ${p.id === estado.calUsuario ? "selected" : ""}>${esc(nombreDe(p))}${p.id === yo.id ? " (yo)" : ""}</option>`).join("")}</select>`
      : "";
    $("#contenido").innerHTML = `
      <div class="barra">
        <button class="btn" id="cal-prev" aria-label="Semana anterior">‹</button>
        <div class="sem-titulo"><div id="cal-titulo"></div><div class="muted" id="cal-sub"></div></div>
        <button class="btn" id="cal-next" aria-label="Semana siguiente">›</button>
        <button class="btn btn-fantasma" id="cal-hoy">Esta semana</button>
        <span class="espacio"></span>
        ${selector}
      </div>
      <div class="sem-pie" id="sem-pie"></div>
      <div class="semana-dias" id="semana"></div>
      <p class="muted ayuda">Elige el cliente, pon el tiempo y, si te han pagado algo en esa casa, apúntalo en «Cobrado». Se guarda solo.
        ${yo.es_admin ? "" : "Si un cliente no está en la lista, pide a tu responsable que lo añada."}</p>`;

    $("#cal-prev").onclick = () => { estado.calLunes = sumarDias(estado.calLunes, -7); pintarCalendario(); };
    $("#cal-next").onclick = () => { estado.calLunes = sumarDias(estado.calLunes, 7); pintarCalendario(); };
    $("#cal-hoy").onclick = () => { estado.calLunes = lunesDe(new Date()); pintarCalendario(); };
    if (yo.es_admin) $("#cal-usuario").onchange = (e) => { estado.calUsuario = e.target.value; pintarCalendario(); };
    pintarCalendario();
  }

  function perfilCal() {
    return estado.calUsuario === estado.yo.id ? estado.yo : estado.perfiles.find((p) => p.id === estado.calUsuario) || estado.yo;
  }

  const OTRO = "__otro";
  function opcionesClientes(sel) {
    const lista = estado.clientes.filter((c) => c.activo || String(c.id) === String(sel));
    return `<option value="">— Elige cliente —</option>`
      + lista.map((c) => `<option value="${c.id}" ${String(c.id) === String(sel) ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")
      + `<option value="${OTRO}" ${sel === OTRO ? "selected" : ""}>✏️ No está en la lista: escribirlo</option>`;
  }

  function lineaHTML(t) {
    const min = t ? Number(t.minutos) : 0;
    const h = t ? Math.floor(min / 60) : "", m = t ? min % 60 : 0;
    const opcionesMin = Array.from({ length: 12 }, (_, i) => i * 5).map((v) => `<option value="${v}" ${v === m ? "selected" : ""}>${String(v).padStart(2, "0")}</option>`).join("");
    const aMano = t && !t.cliente_id;
    const otro = `<input class="l-otro" maxlength="80" placeholder="Escribe el cliente como lo conozcas (ej. casa del perro)" aria-label="Cliente escrito a mano" value="${aMano ? esc(t.cliente) : ""}" ${aMano ? "" : "hidden"}>`;
    return `<div class="linea" data-id="${t ? t.id : ""}">
      <div class="l-buscador">
        <input class="l-busca" autocomplete="off" placeholder="🔍 Busca o elige cliente…" aria-label="Cliente" value="${aMano ? "✏️ Escrito a mano" : t?.cliente_id ? esc(nombreCliente(t)) : ""}">
        <input type="hidden" class="l-cli" value="${aMano ? OTRO : t?.cliente_id ?? ""}">
        <div class="l-sug" role="listbox" hidden></div>
      </div>
      ${otro}
      <span class="l-tiempo">
        <input class="l-h" type="number" inputmode="numeric" min="0" max="16" placeholder="0" aria-label="Horas" value="${h}"><span class="muted">h</span>
        <select class="l-m" aria-label="Minutos">${opcionesMin}</select><span class="muted">min</span>
      </span>
      <label class="l-cobro"><span class="muted">Cobrado</span><input class="l-eur" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" aria-label="Cobrado en esta casa (€)" value="${t && Number(t.cobrado) ? num2(t.cobrado).replace(",", ".") : ""}"><span class="muted">€</span></label>
      <button type="button" class="btn btn-sm btn-fantasma l-borrar" aria-label="Quitar">✕</button>
      <span class="l-estado"></span>
    </div>`;
  }

  async function pintarCalendario() {
    const lunes = estado.calLunes, dom = sumarDias(lunes, 6);
    $("#cal-titulo").textContent = `Semana ${numSemana(lunes)}`;
    $("#cal-sub").textContent = rangoSemana(lunes);

    const [{ data, error }, { data: ants }] = await Promise.all([
      sb.from("trabajos").select("*").eq("usuario_id", estado.calUsuario).gte("fecha", ymd(lunes)).lte("fecha", ymd(dom)).order("id"),
      sb.from("descuentos").select("importe").eq("usuario_id", estado.calUsuario).eq("lunes", ymd(lunes)),
    ]);
    if (error) return aviso(errorTxt(error), true);
    estado.trabajos = new Map(data.map((t) => [String(t.id), t]));
    estado.anticiposSemana = (ants || []).reduce((a, d) => a + Number(d.importe), 0);

    const hoy = ymd(new Date());
    $("#semana").innerHTML = DIAS_LARGOS.map((nombre, i) => {
      const d = sumarDias(lunes, i), k = ymd(d);
      const lista = data.filter((t) => t.fecha === k);
      const clases = ["dia-card", esFinde(d) && "finde", k === hoy && "hoy"].filter(Boolean).join(" ");
      return `<section class="${clases}" data-fecha="${k}">
        <div class="dia-cab">
          <h3>${nombre} <span class="muted">${d.getDate()} ${MESES[d.getMonth()]}</span>${k === hoy ? ' <span class="chip chip-festivo">Hoy</span>' : ""}</h3>
          <span class="dia-total num"></span>
        </div>
        <div class="lineas">${lista.map(lineaHTML).join("")}${lista.length ? "" : lineaHTML(null)}</div>
        <button type="button" class="btn btn-sm l-anadir">+ Añadir cliente</button>
      </section>`;
    }).join("");

    $("#semana").querySelectorAll(".dia-card").forEach((card) => {
      card.querySelector(".l-anadir").onclick = () => {
        card.querySelector(".lineas").insertAdjacentHTML("beforeend", lineaHTML(null));
        prepararLinea(card.querySelector(".lineas .linea:last-child"));
        card.querySelector(".lineas .linea:last-child .l-busca").focus();
      };
      card.querySelectorAll(".linea").forEach(prepararLinea);
    });
    if (!estado.clientes.some((c) => c.activo)) aviso(estado.yo.es_admin ? "Primero da de alta tus clientes en la sección «Clientes»." : "Todavía no hay clientes en la lista. Avisa a tu responsable.", true);
    pintarTotales();
  }

  // Quita acentos y mayúsculas para buscar ("maría" encuentra "MARIA")
  const normal = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function prepararBuscador(el) {
    const inp = el.querySelector(".l-busca"), oculto = el.querySelector(".l-cli"), sug = el.querySelector(".l-sug"), otro = el.querySelector(".l-otro");
    let activo = -1, opciones = [];
    const textoActual = () => (oculto.value === OTRO ? "✏️ Escrito a mano" : clientePorId(oculto.value)?.nombre || "");
    const elegir = (op) => {
      if (!op) return;
      if (op.otro) {
        oculto.value = OTRO; inp.value = "✏️ Escrito a mano";
        otro.hidden = false;
        if (op.texto && !otro.value) otro.value = op.texto;
        setTimeout(() => otro.focus(), 0);
      } else {
        oculto.value = op.id; inp.value = op.nombre; otro.hidden = true;
      }
      cerrar();
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const cerrar = () => { sug.hidden = true; activo = -1; };
    const pintar = () => {
      const q = normal(inp.value === textoActual() ? "" : inp.value);
      const lista = estado.clientes.filter((c) => c.activo && (!q || normal(c.nombre).includes(q)));
      // primero los que empiezan por lo escrito
      if (q) lista.sort((a, b) => (normal(b.nombre).startsWith(q) - normal(a.nombre).startsWith(q)) || a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
      opciones = lista.slice(0, 60).map((c) => ({ id: c.id, nombre: c.nombre }));
      const textoLibre = inp.value.trim() && inp.value !== textoActual() ? inp.value.trim() : "";
      opciones.push({ otro: true, texto: textoLibre });
      sug.innerHTML = opciones.map((o, i) => o.otro
        ? `<div class="l-op l-op-otro ${i === activo ? "activa" : ""}" data-i="${i}" role="option">✏️ No está en la lista: ${textoLibre ? `escribir «${esc(textoLibre)}»` : "escribirlo"}</div>`
        : `<div class="l-op ${i === activo ? "activa" : ""}" data-i="${i}" role="option">${esc(o.nombre)}</div>`).join("")
        + (lista.length > 60 ? `<div class="l-op-info">Hay ${lista.length - 60} más: escribe para filtrar</div>` : "")
        + (!lista.length && q ? `<div class="l-op-info">Ningún cliente se llama así</div>` : "");
      sug.hidden = false;
      sug.querySelector(".activa")?.scrollIntoView({ block: "nearest" });
    };
    inp.addEventListener("focus", () => { inp.select(); pintar(); });
    inp.addEventListener("input", () => { activo = 0; pintar(); });
    inp.addEventListener("keydown", (e) => {
      if (sug.hidden && (e.key === "ArrowDown" || e.key === "Enter")) { pintar(); e.preventDefault(); return; }
      if (e.key === "ArrowDown") { activo = Math.min(opciones.length - 1, activo + 1); pintar(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { activo = Math.max(0, activo - 1); pintar(); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); elegir(opciones[activo >= 0 ? activo : 0]); }
      else if (e.key === "Escape") { inp.value = textoActual(); cerrar(); }
    });
    sug.addEventListener("mousedown", (e) => {
      const d = e.target.closest(".l-op"); if (!d) return;
      e.preventDefault(); elegir(opciones[Number(d.dataset.i)]);
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (!sug.hidden) { inp.value = textoActual(); cerrar(); } }, 120));
  }

  function prepararLinea(el) {
    prepararBuscador(el);
    el.addEventListener("change", (e) => { if (!e.target.classList.contains("l-borrar") && !e.target.classList.contains("l-busca")) encolar(el, guardarLinea); });
    el.querySelector(".l-borrar").onclick = () => encolar(el, borrarLinea);
  }

  const colas = new WeakMap();
  function encolar(el, fn) {
    const prev = colas.get(el) || Promise.resolve();
    const t = prev.then(() => fn(el)).catch((e) => console.error(e));
    colas.set(el, t);
  }

  function marcarLinea(el, txt, mal) {
    const s = el.querySelector(".l-estado");
    if (!s) return;
    s.textContent = txt; s.className = "l-estado " + (mal ? "dif-neg" : "dif-pos");
  }

  async function guardarLinea(el) {
    const fecha = el.closest(".dia-card").dataset.fecha;
    const clienteId = el.querySelector(".l-cli").value;
    const esOtro = clienteId === OTRO;
    const otroInp = el.querySelector(".l-otro");
    otroInp.hidden = !esOtro;
    const textoOtro = otroInp.value.trim();
    const minutos = (parseInt(el.querySelector(".l-h").value, 10) || 0) * 60 + (parseInt(el.querySelector(".l-m").value, 10) || 0);
    const cobrado = Math.max(0, Math.round((parseFloat(String(el.querySelector(".l-eur").value).replace(",", ".")) || 0) * 100) / 100);
    const id = el.dataset.id;
    if (!clienteId && !minutos && !cobrado) { if (id) return borrarLinea(el, true); return marcarLinea(el, ""); }
    if (!clienteId) return marcarLinea(el, "Elige el cliente", true);
    if (esOtro && !textoOtro) { otroInp.focus(); return marcarLinea(el, "Escribe el nombre del cliente", true); }
    if (!minutos) return marcarLinea(el, "Falta el tiempo", true);
    if (minutos > 16 * 60) return marcarLinea(el, "Máximo 16 h", true);
    const cli = esOtro ? null : clientePorId(clienteId);
    const ant = id ? estado.trabajos.get(id) : null;
    const valores = esOtro
      ? { cliente_id: null, cliente: textoOtro, minutos, cobrado }
      : { cliente_id: Number(clienteId), cliente: cli ? cli.nombre : "", minutos, cobrado };
    if (ant && String(ant.cliente_id ?? "") === String(valores.cliente_id ?? "") && ant.cliente === valores.cliente && Number(ant.minutos) === minutos && Number(ant.cobrado) === cobrado) return;
    const res = id
      ? await sb.from("trabajos").update(valores).eq("id", id).select().single()
      : await sb.from("trabajos").insert({ ...valores, usuario_id: perfilCal().id, fecha }).select().single();
    if (res.error) return marcarLinea(el, errorTxt(res.error), true);
    el.dataset.id = res.data.id;
    estado.trabajos.set(String(res.data.id), res.data);
    marcarLinea(el, "✓");
    pintarTotales();
  }

  async function borrarLinea(el, mantener) {
    const id = el.dataset.id;
    if (id) {
      const { error } = await sb.from("trabajos").delete().eq("id", id);
      if (error) return marcarLinea(el, errorTxt(error), true);
      estado.trabajos.delete(id);
    }
    const lineas = el.parentElement;
    if (mantener || lineas.children.length === 1) {
      el.dataset.id = ""; el.querySelector(".l-cli").value = ""; el.querySelector(".l-busca").value = ""; el.querySelector(".l-h").value = ""; el.querySelector(".l-m").value = "0"; el.querySelector(".l-eur").value = "";
      el.querySelector(".l-otro").value = ""; el.querySelector(".l-otro").hidden = true;
      marcarLinea(el, id ? "Borrado" : "");
    } else el.remove();
    pintarTotales();
  }

  function pintarTotales() {
    const porDia = new Map();
    let total = 0, cobrado = 0;
    for (const t of estado.trabajos.values()) { porDia.set(t.fecha, (porDia.get(t.fecha) || 0) + Number(t.minutos)); total += Number(t.minutos); cobrado += Number(t.cobrado) || 0; }
    document.querySelectorAll(".dia-card").forEach((c) => {
      const m = porDia.get(c.dataset.fecha) || 0;
      c.querySelector(".dia-total").innerHTML = m ? fmtMin(m) + " h" : '<span class="cero">0:00 h</span>';
    });
    const c = cuentas(total, perfilCal(), cobrado, estado.anticiposSemana || 0);
    $("#sem-pie").innerHTML = `
      <div><span class="etq">Horas hechas</span><span class="val num">${fmtH(c.horas)}</span><span class="sub">contrato ${fmtH(c.contrato)}</span></div>
      <div><span class="etq">${c.dif >= 0 ? "Horas extra" : "Faltan"}</span><span class="val num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${fmtH(c.dif >= 0 ? c.extra : c.faltan)}</span><span class="sub">× ${eur(c.precio)} = ${eur(c.importe)}</span></div>
      <div><span class="etq">Cobrado en casas</span><span class="val num">${eur(c.cobrado)}</span><span class="sub">esta semana</span></div>`;
  }

  // ================================================================ FICHA PERSONAL
  function camposFicha(p, admin) {
    const ro = admin ? "" : "readonly";
    return `
      <div class="rejilla">
        <div><label for="f-nombre">Nombre</label><input id="f-nombre" value="${esc(p.nombre)}" ${ro}></div>
        <div><label for="f-apellidos">Apellidos</label><input id="f-apellidos" value="${esc(p.apellidos)}" ${ro}></div>
        <div><label for="f-dni">DNI / NIE</label><input id="f-dni" value="${esc(p.dni)}" ${ro}></div>
        <div><label for="f-puesto">Puesto</label><input id="f-puesto" value="${esc(p.puesto)}" ${ro}></div>
        <div><label for="f-horas">Horas de contrato por semana</label><input id="f-horas" type="number" min="0" max="80" step="0.5" value="${Number(p.horas_semanales)}" ${ro}></div>
        <div><label for="f-precio">Precio por hora (€)</label><input id="f-precio" type="number" min="0" max="200" step="0.5" value="${Number(p.precio_hora ?? 8)}" ${ro}></div>
        <div><label for="f-alta">Fecha de alta</label><input id="f-alta" type="date" value="${esc(p.fecha_alta)}" ${ro}></div>
        <div><label for="f-tel">Teléfono</label><input id="f-tel" type="tel" value="${esc(p.telefono)}"></div>
        <div><label for="f-email">Email de contacto</label><input id="f-email" type="email" value="${esc(p.email_contacto)}"></div>
        <div class="ancho"><label for="f-dir">Dirección</label><input id="f-dir" value="${esc(p.direccion)}"></div>
        ${admin ? `<div class="ancho"><label for="f-notas">Notas internas (solo las ve el master)</label><textarea id="f-notas">${esc(p.notas)}</textarea></div>` : ""}
      </div>`;
  }
  function leerFicha(admin) {
    const v = { telefono: $("#f-tel").value.trim(), email_contacto: $("#f-email").value.trim(), direccion: $("#f-dir").value.trim() };
    if (admin) Object.assign(v, {
      nombre: $("#f-nombre").value.trim(), apellidos: $("#f-apellidos").value.trim(), dni: $("#f-dni").value.trim(),
      puesto: $("#f-puesto").value.trim(), horas_semanales: Number($("#f-horas").value) || 0,
      precio_hora: Number($("#f-precio").value) || 0,
      fecha_alta: $("#f-alta").value || null, notas: $("#f-notas").value,
    });
    return v;
  }

  function vistaFicha() {
    const yo = estado.yo;
    $("#contenido").innerHTML = `
      <section class="tarjeta">
        <h2>Mi ficha personal</h2>
        <p class="muted" style="margin:0">Usuario: <b>${esc(yo.usuario)}</b>${yo.es_admin ? "" : " · Los datos del contrato los mantiene tu responsable; tú puedes cambiar tus datos de contacto."}</p>
        <form id="form-ficha">${camposFicha(yo, yo.es_admin)}
          <div class="acciones"><button class="btn btn-primario" type="submit">Guardar ficha</button></div>
        </form>
      </section>
      <section class="tarjeta">
        <h2>Cambiar contraseña</h2>
        <form id="form-pass" class="rejilla">
          <div><label for="p-nueva">Nueva contraseña</label><input id="p-nueva" type="password" minlength="6" autocomplete="new-password" required></div>
          <div><label for="p-rep">Repite la contraseña</label><input id="p-rep" type="password" minlength="6" autocomplete="new-password" required></div>
          <div class="ancho acciones"><button class="btn" type="submit">Cambiar contraseña</button></div>
        </form>
      </section>`;
    $("#form-ficha").onsubmit = async (e) => {
      e.preventDefault();
      const v = leerFicha(yo.es_admin);
      const { data, error } = await sb.from("perfiles").update(v).eq("id", yo.id).select().single();
      if (error) return aviso(errorTxt(error), true);
      estado.yo = data;
      if (yo.es_admin) await cargarPerfiles();
      $("#cab-nombre").textContent = nombreDe(data) + (data.es_admin ? " · master" : "");
      aviso("Ficha guardada");
    };
    $("#form-pass").onsubmit = async (e) => {
      e.preventDefault();
      const a = $("#p-nueva").value, b = $("#p-rep").value;
      if (a !== b) return aviso("Las contraseñas no coinciden", true);
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return aviso(errorTxt(error), true);
      e.target.reset(); aviso("Contraseña cambiada");
    };
  }

  // ================================================================ USUARIOS (master)
  async function vistaUsuarios() {
    await cargarPerfiles();
    const filas = estado.perfiles.map((p) => `
      <tr class="fila-click" data-id="${p.id}">
        <td><b>${esc(nombreDe(p))}</b></td>
        <td class="muted">${esc(p.usuario)}</td>
        <td>${esc(p.puesto) || '<span class="muted">—</span>'}</td>
        <td class="num">${fmtDec(p.horas_semanales)}</td>
        <td class="num">${eur(p.precio_hora ?? 8)}</td>
        <td>${esc(p.telefono) || '<span class="muted">—</span>'}</td>
        <td>${p.es_admin ? '<span class="chip chip-admin">Master</span> ' : ""}<span class="chip ${p.activo ? "chip-activo" : "chip-inactivo"}">${p.activo ? "Activo" : "Inactivo"}</span></td>
      </tr>`).join("");
    $("#contenido").innerHTML = `
      <div class="barra"><h1>Usuarios</h1><span class="espacio"></span>
        <button class="btn btn-primario" id="btn-nuevo">+ Nuevo usuario</button></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Puesto</th><th class="num">Contrato h/sem</th><th class="num">€/hora</th><th>Teléfono</th><th>Estado</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="7" class="vacio">Todavía no hay usuarios.</td></tr>`}</tbody>
      </table></div>
      <p class="muted">Pulsa una fila para ver o editar la ficha. Desactivar a alguien le impide entrar, pero conserva todas sus horas para los informes.</p>`;
    $("#btn-nuevo").onclick = nuevoUsuario;
    document.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => editarUsuario(tr.dataset.id)));
  }

  function nuevoUsuario() {
    abrirModal("Nuevo usuario", `
      <form id="form-nuevo">
        <div class="rejilla">
          <div><label for="n-usuario">Usuario (para entrar)</label><input id="n-usuario" required autocapitalize="none" spellcheck="false" placeholder="ej. laura.g"></div>
          <div><label for="n-pass">Contraseña inicial</label><input id="n-pass" required minlength="6" autocomplete="off" placeholder="mínimo 6 caracteres"></div>
          <div><label for="n-nombre">Nombre</label><input id="n-nombre" required></div>
          <div><label for="n-apellidos">Apellidos</label><input id="n-apellidos"></div>
          <div><label for="n-puesto">Puesto</label><input id="n-puesto" placeholder="ej. Dependiente"></div>
          <div><label for="n-horas">Horas de contrato por semana</label><input id="n-horas" type="number" min="0" max="80" step="0.5" value="10"></div>
          <div><label for="n-precio">Precio por hora (€)</label><input id="n-precio" type="number" min="0" max="200" step="0.5" value="8"></div>
          <div><label for="n-alta">Fecha de alta</label><input id="n-alta" type="date" value="${ymd(new Date())}"></div>
          <div><label for="n-tel">Teléfono</label><input id="n-tel" type="tel"></div>
        </div>
        <p class="muted" style="font-size:.85rem">Dale a la persona su usuario y contraseña. Podrá cambiar la contraseña desde «Mi ficha».</p>
        <p class="error" id="n-error"></p>
        <div class="acciones"><button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario" id="n-btn">Crear usuario</button></div>
      </form>`);
    $("#form-nuevo").onsubmit = async (e) => {
      e.preventDefault();
      const usuario = $("#n-usuario").value.toLowerCase().trim();
      if (!usuarioValido(usuario)) return ($("#n-error").textContent = "El usuario solo admite minúsculas, números, punto, guion y guion bajo (3 a 30 caracteres, sin espacios).");
      if (estado.perfiles.some((p) => p.usuario === usuario)) return ($("#n-error").textContent = "Ese nombre de usuario ya existe.");
      $("#n-btn").disabled = true;
      try {
        const { data, error } = await sbAlta.auth.signUp({
          email: emailDe(usuario), password: $("#n-pass").value,
          options: { data: { usuario, nombre: $("#n-nombre").value.trim() } },
        });
        if (error) throw error;
        if (!data.user || (data.user.identities && data.user.identities.length === 0)) throw new Error("Ese nombre de usuario ya existe.");
        await sbAlta.auth.signOut().catch(() => {});
        const { error: e2 } = await sb.from("perfiles").update({
          activo: true,
          nombre: $("#n-nombre").value.trim(), apellidos: $("#n-apellidos").value.trim(),
          puesto: $("#n-puesto").value.trim(), horas_semanales: Number($("#n-horas").value) || 0,
          precio_hora: Number($("#n-precio").value) || 0,
          fecha_alta: $("#n-alta").value || ymd(new Date()), telefono: $("#n-tel").value.trim(),
        }).eq("id", data.user.id);
        if (e2) throw e2;
        cerrarModal(); aviso(`Usuario «${usuario}» creado`); vistaUsuarios();
      } catch (err) {
        $("#n-error").textContent = errorTxt(err);
        $("#n-btn").disabled = false;
      }
    };
  }

  function editarUsuario(id) {
    const p = estado.perfiles.find((x) => x.id === id);
    if (!p) return;
    const soyYo = p.id === estado.yo.id;
    abrirModal(nombreDe(p), `
      <form id="form-edit">
        <p class="muted" style="margin:0">Usuario: <b>${esc(p.usuario)}</b></p>
        ${camposFicha(p, true)}
        ${soyYo ? "" : `
        <div class="rejilla">
          <div><label for="u-activo">Estado</label><select id="u-activo">
            <option value="1" ${p.activo ? "selected" : ""}>Activo (puede entrar y apuntar horas)</option>
            <option value="0" ${!p.activo ? "selected" : ""}>Inactivo (no puede entrar)</option></select></div>
          <div><label for="u-admin">Permisos</label><select id="u-admin">
            <option value="0" ${!p.es_admin ? "selected" : ""}>Trabajador (solo ve lo suyo)</option>
            <option value="1" ${p.es_admin ? "selected" : ""}>Master (ve a todos)</option></select></div>
        </div>`}
        <p class="error" id="u-error"></p>
        <div class="acciones">
          <button type="button" class="btn izq" id="u-cal">Ver su calendario</button>
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>`);
    $("#u-cal").onclick = () => { estado.calUsuario = p.id; cerrarModal(); location.hash = "calendario"; if (estado.vista === "calendario") irA("calendario"); };
    $("#form-edit").onsubmit = async (e) => {
      e.preventDefault();
      const v = leerFicha(true);
      if (!soyYo) { v.activo = $("#u-activo").value === "1"; v.es_admin = $("#u-admin").value === "1"; }
      const { error } = await sb.from("perfiles").update(v).eq("id", p.id);
      if (error) return ($("#u-error").textContent = errorTxt(error));
      if (soyYo) { const { data } = await sb.from("perfiles").select("*").eq("id", p.id).single(); if (data) estado.yo = data; }
      cerrarModal(); aviso("Ficha guardada"); vistaUsuarios();
    };
  }

  // ================================================================ CLIENTES Y FACTURACIÓN (master)
  const r2 = (x) => Math.round(x * 100) / 100;

  async function vistaClientes() {
    await Promise.all([cargarListaClientes(), cargarPerfiles()]);
    $("#contenido").innerHTML = `
      <div class="barra"><h1>Clientes</h1><span class="espacio"></span>
        <button class="btn" id="cli-pegar">Pegar lista</button>
        <button class="btn btn-primario" id="cli-nuevo">+ Nuevo cliente</button></div>
      <div class="barra">
        <button class="btn btn-sm" id="cli-prev" aria-label="Mes anterior">‹</button>
        <div class="titulo-periodo" id="cli-mes"></div>
        <button class="btn btn-sm" id="cli-next" aria-label="Mes siguiente">›</button>
        <button class="btn btn-sm btn-fantasma" id="cli-hoy">Este mes</button>
        <span class="espacio"></span>
        <input id="cli-buscar" type="search" placeholder="🔍 Buscar cliente…" title="Busca por nombre, dirección o teléfono" style="width:200px" aria-label="Buscar cliente">
        <select id="cli-orden" aria-label="Ordenar" style="width:auto">
          <option value="az">Orden: A → Z</option><option value="za">Orden: Z → A</option><option value="horas">Más horas</option><option value="visitas">Más visitas</option><option value="cobrado">Más cobrado en efectivo</option></select>
        <select id="cli-filtro" aria-label="Mostrar" style="width:auto">
          <option value="mes">Con visitas este mes</option><option value="todos">Todos los clientes</option></select>
        <button class="btn btn-sm btn-primario" id="cli-xls">Descargar Excel del mes</button>
      </div>
      <div class="resumen" id="cli-resumen"></div>
      <div class="tabla-envoltura" id="cli-tabla"></div>
      <p class="muted">Pulsa un cliente para ver su ficha y sus visitas del mes. Desactivar un cliente lo quita de la lista de las trabajadoras pero conserva su historial.</p>`;
    $("#cli-nuevo").onclick = () => editarCliente(null);
    $("#cli-pegar").onclick = pegarClientes;
    $("#cli-prev").onclick = () => { estado.cliMes = new Date(estado.cliMes.getFullYear(), estado.cliMes.getMonth() - 1, 1); pintarClientes(); };
    $("#cli-next").onclick = () => { estado.cliMes = new Date(estado.cliMes.getFullYear(), estado.cliMes.getMonth() + 1, 1); pintarClientes(); };
    $("#cli-hoy").onclick = () => { estado.cliMes = inicioMes(new Date()); pintarClientes(); };
    $("#cli-buscar").oninput = () => pintarTablaClientes();
    $("#cli-filtro").onchange = () => pintarTablaClientes();
    $("#cli-orden").onchange = () => pintarTablaClientes();
    $("#cli-xls").onclick = async (e) => {
      e.target.disabled = true;
      try { mostrarPrevia(await excelClientesMes()); } catch (err) { aviso("No se pudo generar el Excel: " + (err.message || err), true); }
      e.target.disabled = false;
    };
    pintarClientes();
  }

  async function pintarClientes() {
    const mes = estado.cliMes, fin = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    $("#cli-mes").textContent = `${MESES[mes.getMonth()]} ${mes.getFullYear()}`;
    const { data, error } = await sb.from("trabajos").select("*").gte("fecha", ymd(mes)).lte("fecha", ymd(fin)).order("fecha");
    if (error) return aviso(errorTxt(error), true);
    estado.cliTrabajos = data;
    pintarTablaClientes();
  }

  function statsClientes() {
    const nuevo = (c) => ({ c, min: 0, visitas: 0, cobrado: 0, gente: new Set(), lista: [] });
    const st = new Map();
    estado.clientes.forEach((c) => st.set(String(c.id), nuevo(c)));
    const sueltos = new Map();
    (estado.cliTrabajos || []).forEach((t) => {
      let s = t.cliente_id ? st.get(String(t.cliente_id)) : null;
      if (!s) {
        const k = "x:" + t.cliente.trim().toLowerCase();
        s = sueltos.get(k) || nuevo({ id: null, nombre: t.cliente.trim() + " (escrito a mano)", nombreOriginal: t.cliente.trim(), direccion: "", telefono: "", activo: true });
        sueltos.set(k, s);
      }
      s.min += Number(t.minutos); s.visitas++; s.cobrado += Number(t.cobrado) || 0; s.gente.add(t.usuario_id); s.lista.push(t);
    });
    return [...st.values(), ...sueltos.values()].map((s) => { s.cobrado = r2(s.cobrado); return s; });
  }

  function pintarTablaClientes() {
    const q = ($("#cli-buscar")?.value || "").trim().toLowerCase();
    const filtro = $("#cli-filtro")?.value || "mes";
    const todos = statsClientes();
    const lista = todos
      .filter((s) => !q || normal(s.c.nombre).includes(normal(q)) || normal(s.c.direccion).includes(normal(q)) || normal(s.c.telefono).includes(normal(q)))
      .filter((s) => filtro === "todos" || s.visitas > 0)
      .sort((a, b) => {
        const az = a.c.nombre.localeCompare(b.c.nombre, "es", { sensitivity: "base" });
        switch ($("#cli-orden")?.value || "az") {
          case "za": return -az;
          case "horas": return (b.min - a.min) || az;
          case "visitas": return (b.visitas - a.visitas) || az;
          case "cobrado": return (b.cobrado - a.cobrado) || az;
          default: return az;
        }
      });
    const T = todos.reduce((a, s) => ({ min: a.min + s.min, vis: a.vis + s.visitas, cob: a.cob + s.cobrado, conCob: a.conCob + (s.cobrado ? 1 : 0) }), { min: 0, vis: 0, cob: 0, conCob: 0 });
    $("#cli-resumen").innerHTML = `
      <div class="dato"><div class="etq">Horas del mes</div><div class="val">${fmtMin(T.min)}</div><div class="sub">${num2(T.min / 60)} h decimales</div></div>
      <div class="dato"><div class="etq">Visitas</div><div class="val">${T.vis}</div><div class="sub">${todos.filter((s) => s.visitas).length} clientes distintos</div></div>
      <div class="dato"><div class="etq">Cobrado en efectivo</div><div class="val">${eur(T.cob)}</div><div class="sub">${T.conCob} clientes han pagado en mano</div></div>
      <div class="dato"><div class="etq">Clientes activos</div><div class="val">${estado.clientes.filter((c) => c.activo).length}</div><div class="sub">en la lista de las trabajadoras</div></div>`;
    const cero = '<span class="cero">·</span>';
    $("#cli-tabla").innerHTML = `<table>
      <thead><tr><th>Cliente</th><th>Teléfono</th><th class="num">Horas</th><th class="num">Visitas</th><th class="num">Cobrado en efectivo</th><th>Quién ha ido</th><th>Estado</th></tr></thead>
      <tbody>${lista.map((s) => `<tr class="fila-click" data-cli="${s.c.id ?? ""}" data-suelto="${s.c.id ? "" : esc(s.c.nombreOriginal)}">
        <td><b>${esc(s.c.nombre)}</b>${s.c.direccion ? `<div class="muted" style="font-size:.78rem">${esc(s.c.direccion)}</div>` : ""}</td>
        <td class="muted">${esc(s.c.telefono) || "—"}</td>
        <td class="num">${s.min ? fmtMin(s.min) : cero}</td><td class="num">${s.visitas || cero}</td>
        <td class="num"><b>${s.cobrado ? eur(s.cobrado) : cero}</b></td>
        <td class="muted">${[...s.gente].map((id) => esc(nombreDe(estado.perfiles.find((p) => p.id === id)))).join(", ")}</td>
        <td>${s.c.id ? `<span class="chip ${s.c.activo ? "chip-activo" : "chip-inactivo"}">${s.c.activo ? "Activo" : "Inactivo"}</span>` : '<span class="chip chip-ausencia">Sin ficha · asignar</span>'}</td></tr>`).join("")
        || `<tr><td colspan="7" class="vacio">${q ? "Ningún cliente coincide con la búsqueda." : filtro === "mes" ? "Ningún cliente tiene visitas este mes. Cambia a «Todos los clientes» para verlos." : "No hay clientes. Pulsa «+ Nuevo cliente» o «Pegar lista»."}</td></tr>`}</tbody>
      ${lista.length > 1 ? `<tfoot><tr><td>Total</td><td></td><td class="num">${fmtMin(T.min)}</td><td class="num">${T.vis}</td><td class="num">${eur(T.cob)}</td><td></td><td></td></tr></tfoot>` : ""}
    </table>`;
    document.querySelectorAll("tr[data-cli]").forEach((tr) => { tr.onclick = () => (tr.dataset.cli ? editarCliente(tr.dataset.cli) : asignarSuelto(tr.dataset.suelto)); });
  }

  // Cliente escrito a mano por una trabajadora: asignarlo a un cliente existente o crear su ficha
  function asignarSuelto(nombre) {
    const s = statsClientes().find((x) => !x.c.id && x.c.nombreOriginal === nombre);
    if (!s) return;
    const opts = estado.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    abrirModal("Asignar cliente", `
      <form id="form-suelto">
        <p style="margin:0">Las trabajadoras han apuntado <b>«${esc(nombre)}»</b>: ${s.visitas} ${s.visitas === 1 ? "visita" : "visitas"} y ${fmtMin(s.min)} h este mes
          (${[...s.gente].map((id) => esc(nombreDe(estado.perfiles.find((p) => p.id === id)))).join(", ")}).</p>
        <label for="su-modo">¿Qué es?</label>
        <select id="su-modo"><option value="existe">Es un cliente que ya tengo en la lista</option><option value="nuevo">Es un cliente nuevo: crear su ficha</option></select>
        <div id="su-existe"><label for="su-cli">Cliente</label><select id="su-cli"><option value="">— Elige cliente —</option>${opts}</select></div>
        <div id="su-nuevo" hidden><label for="su-nom">Nombre del cliente nuevo</label><input id="su-nom" maxlength="80" value="${esc(nombre)}"></div>
        <p class="muted" style="font-size:.85rem">Se pasarán a ese cliente todas las líneas escritas como «${esc(nombre)}», también las de otros meses.</p>
        <p class="error" id="su-error"></p>
        <div class="acciones"><button type="button" class="btn" data-cerrar>Cancelar</button><button type="submit" class="btn btn-primario" id="su-btn">Guardar</button></div>
      </form>`);
    $("#su-modo").onchange = () => { const n = $("#su-modo").value === "nuevo"; $("#su-existe").hidden = n; $("#su-nuevo").hidden = !n; };
    $("#form-suelto").onsubmit = async (e) => {
      e.preventDefault();
      $("#su-btn").disabled = true;
      try {
        let cli;
        if ($("#su-modo").value === "nuevo") {
          const nom = $("#su-nom").value.trim();
          if (!nom) throw new Error("Pon el nombre del cliente.");
          const r = await sb.from("clientes").insert({ nombre: nom }).select().single();
          if (r.error) throw new Error(/duplicate|unique/i.test(r.error.message) ? "Ya hay un cliente con ese nombre: elige «Es un cliente que ya tengo en la lista»." : errorTxt(r.error));
          cli = r.data;
        } else {
          cli = clientePorId($("#su-cli").value);
          if (!cli) throw new Error("Elige el cliente de la lista.");
        }
        const patron = nombre.replace(/[\\%_]/g, (m) => "\\" + m);
        const { error } = await sb.from("trabajos").update({ cliente_id: cli.id, cliente: cli.nombre }).is("cliente_id", null).ilike("cliente", patron);
        if (error) throw new Error(errorTxt(error));
        cerrarModal(); aviso(`«${nombre}» pasado a ${cli.nombre}`);
        await cargarListaClientes(); pintarClientes();
      } catch (err) {
        $("#su-error").textContent = err.message; $("#su-btn").disabled = false;
      }
    };
  }

  function editarCliente(id) {
    const c = id ? clientePorId(id) : { nombre: "", direccion: "", telefono: "", notas: "", activo: true };
    const s = id ? statsClientes().find((x) => String(x.c.id) === String(id)) : null;
    const mes = estado.cliMes;
    abrirModal(id ? c.nombre : "Nuevo cliente", `
      <form id="form-cli">
        <div class="rejilla">
          <div class="ancho"><label for="c-nombre">Nombre del cliente</label><input id="c-nombre" required maxlength="80" value="${esc(c.nombre)}" placeholder="ej. Duplex Roger de Flor"></div>
          <div class="ancho"><label for="c-dir">Dirección</label><input id="c-dir" value="${esc(c.direccion)}"></div>
          <div><label for="c-tel">Teléfono</label><input id="c-tel" type="tel" value="${esc(c.telefono)}"></div>
          <div><label for="c-activo">Estado</label><select id="c-activo"><option value="1" ${c.activo ? "selected" : ""}>Activo (sale en la lista)</option><option value="0" ${!c.activo ? "selected" : ""}>Inactivo</option></select></div>
          <div class="ancho"><label for="c-notas">Notas (llaves, horario, lo que haya que saber…)</label><textarea id="c-notas">${esc(c.notas)}</textarea></div>
        </div>
        ${s ? `<h3 style="margin-top:18px">${MESES[mes.getMonth()][0].toUpperCase() + MESES[mes.getMonth()].slice(1)}: ${s.visitas} visitas · ${fmtMin(s.min)} h ${s.cobrado ? ` · cobrado en efectivo ${eur(s.cobrado)}` : ""}</h3>
          ${s.visitas ? `<div class="tabla-envoltura" style="margin-top:8px"><table><thead><tr><th>Fecha</th><th>Quién</th><th class="num">Tiempo</th><th class="num">Cobrado en efectivo</th></tr></thead><tbody>
          ${s.lista.map((t) => `<tr><td>${diaCorto(deYmd(t.fecha))}</td><td>${esc(nombreDe(estado.perfiles.find((p) => p.id === t.usuario_id)))}</td><td class="num">${fmtMin(t.minutos)}</td><td class="num">${Number(t.cobrado) ? eur(t.cobrado) : "—"}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Sin visitas este mes.</p>`}` : ""}
        <p class="error" id="c-error"></p>
        <div class="acciones">
          ${id ? `<button type="button" class="btn btn-peligro izq" id="c-borrar">Borrar cliente</button>` : ""}
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>`);
    if (id) $("#c-borrar").onclick = async () => {
      if ($("#c-borrar").dataset.ok !== "1") {
        $("#c-borrar").dataset.ok = "1";
        $("#c-borrar").textContent = "Pulsa otra vez para borrar";
        $("#c-error").textContent = s?.visitas ? "Este cliente tiene visitas este mes. Mejor ponlo Inactivo para conservar su historial." : "Si tiene visitas de otros meses, mejor ponlo Inactivo.";
        return;
      }
      const { error } = await sb.from("clientes").delete().eq("id", id);
      if (error) return ($("#c-error").textContent = errorTxt(error));
      cerrarModal(); aviso("Cliente borrado"); await cargarListaClientes(); pintarTablaClientes();
    };
    $("#form-cli").onsubmit = async (e) => {
      e.preventDefault();
      const v = { nombre: $("#c-nombre").value.trim(), direccion: $("#c-dir").value.trim(), telefono: $("#c-tel").value.trim(), notas: $("#c-notas").value, activo: $("#c-activo").value === "1" };
      if (!v.nombre) return ($("#c-error").textContent = "Pon el nombre del cliente.");
      const res = id ? await sb.from("clientes").update(v).eq("id", id).select().single() : await sb.from("clientes").insert(v).select().single();
      if (res.error) return ($("#c-error").textContent = /duplicate|unique/i.test(res.error.message) ? "Ya hay un cliente con ese nombre." : errorTxt(res.error));
      const cid = res.data.id;
      if (id) await sb.from("trabajos").update({ cliente: v.nombre }).eq("cliente_id", id);
      cerrarModal(); aviso(id ? "Cliente guardado" : "Cliente creado"); await cargarListaClientes(); pintarTablaClientes();
    };
  }

  function pegarClientes() {
    abrirModal("Pegar lista de clientes", `
      <form id="form-pegar">
        <label for="pg-lista">Un cliente por línea. Si quieres, añade la dirección y el teléfono separados por «;»</label>
        <textarea id="pg-lista" style="min-height:220px;font-family:var(--f-num)" placeholder="Dolores; C/ Mayor 5; 600111222&#10;Peluquería&#10;Escalera Sant Pere&#10;Duplex Roger de Flor"></textarea>
        <p class="muted" id="pg-info" style="font-size:.85rem"></p>
        <p class="error" id="pg-error"></p>
        <div class="acciones"><button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario" id="pg-btn">Crear clientes</button></div>
      </form>`);
    const leer = () => {
      const existentes = new Set(estado.clientes.map((c) => c.nombre.trim().toLowerCase()));
      const vistos = new Set();
      return $("#pg-lista").value.split(/\r?\n/).map((l) => l.split(/[;\t]/).map((x) => x.trim()))
        .filter(([n]) => n && n.length <= 80)
        .filter(([n]) => { const k = n.toLowerCase(); if (existentes.has(k) || vistos.has(k)) return false; vistos.add(k); return true; })
        .map(([nombre, direccion = "", telefono = ""]) => ({ nombre, direccion, telefono }));
    };
    $("#pg-lista").oninput = () => { const n = leer().length; $("#pg-info").textContent = n ? `Se crearán ${n} clientes nuevos (los repetidos se saltan).` : ""; };
    $("#form-pegar").onsubmit = async (e) => {
      e.preventDefault();
      const filas = leer();
      if (!filas.length) return ($("#pg-error").textContent = "No hay clientes nuevos en la lista.");
      $("#pg-btn").disabled = true;
      const { data, error } = await sb.from("clientes").insert(filas).select();
      if (error) { $("#pg-btn").disabled = false; return ($("#pg-error").textContent = errorTxt(error)); }
      cerrarModal(); aviso(`${filas.length} clientes creados`); await cargarListaClientes(); pintarTablaClientes();
    };
  }

  // ================================================================ INFORMES SEMANALES (master)
  async function vistaInformes() {
    await Promise.all([cargarPerfiles(), cargarListaClientes()]);
    $("#contenido").innerHTML = `
      <div class="barra no-imprimir">
        <button class="btn btn-sm" id="inf-prev" aria-label="Semana anterior">‹</button>
        <button class="btn btn-sm" id="inf-next" aria-label="Semana siguiente">›</button>
        <button class="btn btn-sm btn-fantasma" id="inf-hoy">Esta semana</button>
        <button class="btn btn-sm btn-fantasma" id="inf-ant">Semana pasada</button>
        <span class="espacio"></span>
        <button class="btn btn-sm btn-primario" id="inf-csv">Descargar Excel</button>
        <button class="btn btn-sm" id="inf-print">Imprimir / PDF (todos)</button>
      </div>
      <div><h1 id="inf-titulo"></h1><p class="muted" id="inf-sub" style="margin:4px 0 0"></p></div>
      <div class="resumen" id="inf-resumen"></div>
      <div class="tabla-envoltura" id="inf-tabla"></div>
      <section class="detalle" id="inf-detalle"></section>
      <section class="tarjeta no-imprimir" id="inf-historico"></section>`;
    const mover = (n) => { estado.infLunes = sumarDias(estado.infLunes, n); pintarInforme(); };
    $("#inf-prev").onclick = () => mover(-7);
    $("#inf-next").onclick = () => mover(7);
    $("#inf-hoy").onclick = () => { estado.infLunes = lunesDe(new Date()); pintarInforme(); };
    $("#inf-ant").onclick = () => { estado.infLunes = sumarDias(lunesDe(new Date()), -7); pintarInforme(); };
    $("#inf-print").onclick = () => { document.body.classList.remove("imprimir-ficha"); window.print(); };
    $("#inf-csv").onclick = () => { estado.xlsSel = null; dialogoExcel(""); };
    pintarInforme();
  }

  // Datos de una o varias semanas: trabajos, anticipos y observaciones
  async function datosSemanas(desde, hasta, personaId) {
    const fin = sumarDias(hasta, 6);
    let q1 = sb.from("trabajos").select("*").gte("fecha", ymd(desde)).lte("fecha", ymd(fin)).order("fecha").order("id");
    let q2 = sb.from("descuentos").select("*").gte("lunes", ymd(desde)).lte("lunes", ymd(hasta)).order("id");
    let q3 = sb.from("semanas").select("*").gte("lunes", ymd(desde)).lte("lunes", ymd(hasta));
    if (personaId) { q1 = q1.eq("usuario_id", personaId); q2 = q2.eq("usuario_id", personaId); q3 = q3.eq("usuario_id", personaId); }
    const [a, b, c] = await Promise.all([q1, q2, q3]);
    const err = a.error || b.error || c.error;
    if (err) throw new Error(errorTxt(err));
    return { trabajos: a.data, descuentos: b.data, semanas: c.data };
  }

  // Resumen de una persona en una semana
  function semanaPersona(D, p, lunes) {
    const k0 = ymd(lunes), k6 = ymd(sumarDias(lunes, 6));
    const ls = D.trabajos.filter((t) => t.usuario_id === p.id && t.fecha >= k0 && t.fecha <= k6);
    const ants = D.descuentos.filter((d) => d.usuario_id === p.id && d.lunes === k0);
    const ficha = D.semanas.find((s) => s.usuario_id === p.id && s.lunes === k0) || { observaciones: "", entregado: null };
    const min = ls.reduce((a, t) => a + Number(t.minutos), 0);
    const cobrado = ls.reduce((a, t) => a + (Number(t.cobrado) || 0), 0);
    const anticipos = ants.reduce((a, d) => a + Number(d.importe), 0);
    return { ls, ants, ficha, min, c: cuentas(min, p, cobrado, anticipos) };
  }

  async function pintarInforme() {
    const lunes = estado.infLunes;
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    const kd = dias.map(ymd);
    $("#inf-titulo").textContent = `Informe semana ${numSemana(lunes)}`;
    $("#inf-sub").textContent = rangoSemana(lunes);

    let D, H;
    try {
      [D, H] = await Promise.all([datosSemanas(lunes, lunes), datosSemanas(sumarDias(lunes, -49), sumarDias(lunes, -7))]);
    } catch (e) { return aviso(e.message, true); }
    estado.infDatos = D;

    const conHoras = new Set(D.trabajos.map((t) => t.usuario_id));
    const personas = estado.perfiles.filter((p) => conHoras.has(p.id) || (p.activo && !p.es_admin));
    const minDia = (pid, k) => D.trabajos.filter((t) => t.usuario_id === pid && t.fecha === k).reduce((a, t) => a + Number(t.minutos), 0);

    const totDia = Array(7).fill(0);
    const T = { horas: 0, contrato: 0, extra: 0, importe: 0, descuentos: 0, apagar: 0 };
    const filas = personas.map((p) => {
      const sp = semanaPersona(D, p, lunes);
      const celdas = kd.map((k, i) => { const m = minDia(p.id, k); totDia[i] += m; return `<td class="num ${esFinde(dias[i]) ? "finde" : ""}">${m ? fmtMin(m) : '<span class="cero">·</span>'}</td>`; }).join("");
      const c = sp.c;
      Object.keys(T).forEach((k) => (T[k] += c[k]));
      return { p, sp, html: `<tr><td><b>${esc(nombreDe(p))}</b></td>${celdas}
        <td class="num"><b>${fmtH(c.horas)}</b></td><td class="num muted">${fmtH(c.contrato)}</td>
        <td class="num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${c.dif >= 0 ? fmtH(c.extra) : "−" + fmtH(c.faltan)}</td>
        <td class="num muted">${eur(c.precio)}</td><td class="num">${eur(c.importe)}</td>
        <td class="num muted">${c.descuentos ? "−" + eur(c.descuentos) : "·"}</td><td class="num"><b>${eur(c.apagar)}</b></td></tr>` };
    });

    $("#inf-tabla").innerHTML = `<table>
      <thead><tr><th>Persona</th>${dias.map((d) => `<th class="num ${esFinde(d) ? "finde" : ""}">${diaCorto(d)}</th>`).join("")}
        <th class="num">Total</th><th class="num">Contrato</th><th class="num">Extra</th><th class="num">€/hora</th><th class="num">Importe</th><th class="num">Cobrado + ant.</th><th class="num">A pagar</th></tr></thead>
      <tbody>${filas.map((f) => f.html).join("") || `<tr><td colspan="15" class="vacio">No hay trabajadoras activas.</td></tr>`}</tbody>
      <tfoot><tr><td>Total</td>${totDia.map((m, i) => `<td class="num ${esFinde(dias[i]) ? "finde" : ""}">${fmtMin(m)}</td>`).join("")}
        <td class="num">${fmtH(T.horas)}</td><td class="num">${fmtH(T.contrato)}</td><td class="num dif-pos">${fmtH(T.extra)}</td><td></td>
        <td class="num">${eur(T.importe)}</td><td class="num">${T.descuentos ? "−" + eur(T.descuentos) : ""}</td><td class="num">${eur(T.apagar)}</td></tr></tfoot>
    </table>`;

    const sinApuntar = personas.filter((p) => p.activo && !conHoras.has(p.id));
    $("#inf-resumen").innerHTML = `
      <div class="dato"><div class="etq">Horas hechas</div><div class="val">${fmtH(T.horas)}</div><div class="sub">contrato ${fmtH(T.contrato)} · extra ${fmtH(T.extra)}</div></div>
      <div class="dato"><div class="etq">Importe horas extra</div><div class="val">${eur(T.importe)}</div><div class="sub">horas extra × precio de cada una</div></div>
      <div class="dato"><div class="etq">Cobrado en casas + anticipos</div><div class="val">${eur(T.descuentos)}</div><div class="sub">se descuenta</div></div>
      <div class="dato"><div class="etq">Total a pagar</div><div class="val">${eur(T.apagar)}</div><div class="sub">${sinApuntar.length ? "Sin apuntar: " + sinApuntar.map((p) => esc(p.nombre || p.usuario)).join(", ") : "todas han apuntado"}</div></div>`;

    // Fichas semanales
    $("#inf-detalle").innerHTML = `<h2 class="no-imprimir">Fichas semanales por persona</h2>` + filas.map(({ p, sp }) => {
      const { ls, ants, ficha, c } = sp;
      const cuerpo = kd.map((k, i) => {
        const delDia = ls.filter((t) => t.fecha === k);
        const sub = delDia.reduce((a, t) => a + Number(t.minutos), 0);
        const fd = esFinde(dias[i]) ? "finde" : "";
        if (!delDia.length) return `<tr><td class="${fd}">${diaCorto(dias[i])}</td><td class="cero">—</td><td class="num cero">0:00</td><td class="num cero"></td><td class="num cero"></td></tr>`;
        return delDia.map((t, j) => `<tr class="${j === 0 ? "dia-ini" : ""}"><td class="${fd}">${j === 0 ? diaCorto(dias[i]) : ""}</td><td>${esc(nombreCliente(t))}</td><td class="num">${fmtMin(t.minutos)}</td>
          <td class="num">${Number(t.cobrado) ? eur(t.cobrado) : ""}</td><td class="num">${j === delDia.length - 1 ? "<b>" + fmtMin(sub) + "</b>" : ""}</td></tr>`).join("");
      }).join("");
      const cobros = ls.filter((t) => Number(t.cobrado));
      return `
      <div class="detalle-persona tarjeta" data-persona="${p.id}">
        <div class="barra">
          <h3>${esc(nombreDe(p))} <span class="muted" style="font-weight:500">${eur(c.precio)}/h · contrato ${fmtH(c.contrato)} h</span></h3>
          <span class="espacio"></span>
          <span class="no-imprimir"><button class="btn btn-sm btn-primario" data-csv="${p.id}">Descargar Excel</button>
          <button class="btn btn-sm" data-imprimir="${p.id}">Imprimir / PDF</button></span>
        </div>
        <p class="solo-imprimir">${esc(rangoSemana(lunes))} (semana ${numSemana(lunes)})</p>
        <div class="ficha-cols">
          <div class="tabla-envoltura"><table class="tabla-ficha">
            <thead><tr><th>Día</th><th>Cliente</th><th class="num">Tiempo</th><th class="num">Cobrado</th><th class="num">Total día</th></tr></thead>
            <tbody>${cuerpo}</tbody>
          </table></div>
          <div class="ficha-lado">
            <div class="cuentas">
              <div><span>Horas hechas</span><b class="num">${fmtH(c.horas)}</b></div>
              <div><span>− Horas de contrato</span><b class="num">${fmtH(c.contrato)}</b></div>
              <div><span>= ${c.dif >= 0 ? "Horas extra" : "Faltan"}</span><b class="num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${fmtH(c.dif >= 0 ? c.extra : c.faltan)}</b></div>
              <div><span>Importe (${num2(c.extra)} h × ${eur(c.precio)})</span><b class="num">${eur(c.importe)}</b></div>
              ${cobros.map((t) => `<div class="desc"><span>− Cobrado en ${esc(nombreCliente(t))}</span><b class="num">${eur(t.cobrado)}</b></div>`).join("")}
              ${ants.map((d) => `<div class="desc"><span>− ${esc(d.concepto || "Anticipo")}</span><b class="num">${eur(d.importe)}</b></div>`).join("")}
              <div class="total"><span>${c.apagar >= 0 ? "A pagar" : "A devolver"}</span><b class="num">${eur(Math.abs(c.apagar))}</b></div>
            </div>
            <div class="no-imprimir ficha-extra">
              <h4>Anticipos y otros descuentos</h4>
              <div class="ants" data-ants="${p.id}">${ants.map((d) => antHTML(d)).join("")}</div>
              <button type="button" class="btn btn-sm" data-ant-add="${p.id}">+ Añadir anticipo</button>
              <label for="obs-${p.id}">Observaciones</label>
              <textarea id="obs-${p.id}" data-obs="${p.id}" placeholder="Sale en la hoja de la semana">${esc(ficha.observaciones)}</textarea>
              <label for="ent-${p.id}">Entregada el</label>
              <input id="ent-${p.id}" type="date" data-ent="${p.id}" value="${ficha.entregado || ""}" style="max-width:180px">
            </div>
            ${ficha.observaciones ? `<p class="solo-imprimir"><b>Observaciones:</b> ${esc(ficha.observaciones)}</p>` : ""}
          </div>
        </div>
        <div class="firmas solo-imprimir"><div>Firma del trabajador</div><div>Firma de la empresa</div></div>
      </div>`;
    }).join("");

    // Eventos de la ficha
    document.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => { estado.xlsSel = null; dialogoExcel(b.dataset.csv); }));
    document.querySelectorAll("[data-imprimir]").forEach((b) => (b.onclick = () => {
      document.querySelectorAll(".detalle-persona").forEach((el) => el.classList.toggle("seleccionada", el.dataset.persona === b.dataset.imprimir));
      document.body.classList.add("imprimir-ficha");
      window.print();
      setTimeout(() => document.body.classList.remove("imprimir-ficha"), 500);
    }));
    document.querySelectorAll("[data-ant-add]").forEach((b) => (b.onclick = () => {
      const cont = document.querySelector(`[data-ants="${b.dataset.antAdd}"]`);
      cont.insertAdjacentHTML("beforeend", antHTML(null));
      prepararAnt(cont.lastElementChild, b.dataset.antAdd);
      cont.lastElementChild.querySelector("input").focus();
    }));
    document.querySelectorAll("[data-ants]").forEach((cont) => cont.querySelectorAll(".ant").forEach((el) => prepararAnt(el, cont.dataset.ants)));
    const guardarSemana = async (pid) => {
      const fila = { usuario_id: pid, lunes: ymd(lunes), observaciones: $(`#obs-${pid}`).value, entregado: $(`#ent-${pid}`).value || null };
      const { error } = await sb.from("semanas").upsert(fila, { onConflict: "usuario_id,lunes" });
      if (error) return aviso(errorTxt(error), true);
      aviso("Guardado");
    };
    document.querySelectorAll("[data-obs]").forEach((el) => (el.onchange = () => guardarSemana(el.dataset.obs)));
    document.querySelectorAll("[data-ent]").forEach((el) => (el.onchange = () => guardarSemana(el.dataset.ent)));

    // Últimas semanas
    const lunesHist = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, -7 * (7 - i)));
    $("#inf-historico").innerHTML = `<h2>Semanas anteriores</h2><p class="muted" style="margin:0 0 10px">Horas hechas y, debajo, lo que hubo que pagar.</p><div class="tabla-envoltura"><table>
      <thead><tr><th>Persona</th>${lunesHist.map((l) => `<th class="num">S${numSemana(l)}<div style="font-weight:500;text-transform:none">${l.getDate()} ${MESES[l.getMonth()].slice(0, 3)}</div></th>`).join("")}</tr></thead>
      <tbody>${personas.map((p) => `<tr><td>${esc(nombreDe(p))}</td>${lunesHist.map((l) => { const sp = semanaPersona(H, p, l); return `<td class="num">${sp.min ? fmtMin(sp.min) + `<div class="muted" style="font-size:.78rem">${eur(sp.c.apagar)}</div>` : '<span class="cero">·</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function antHTML(d) {
    return `<div class="ant" data-id="${d ? d.id : ""}">
      <input class="a-con" placeholder="Concepto (ej. Anticipo, gasolina…)" maxlength="80" value="${d ? esc(d.concepto) : ""}" aria-label="Concepto">
      <input class="a-imp" type="number" step="0.01" min="0" placeholder="0" value="${d ? Number(d.importe) : ""}" aria-label="Importe"><span class="muted">€</span>
      <button type="button" class="btn btn-sm btn-fantasma a-x" aria-label="Quitar">✕</button></div>`;
  }
  function prepararAnt(el, pid) {
    const guardar = async () => {
      const concepto = el.querySelector(".a-con").value.trim();
      const importe = Math.round((parseFloat(el.querySelector(".a-imp").value) || 0) * 100) / 100;
      const id = el.dataset.id;
      if (!concepto && !importe) return;
      const res = id ? await sb.from("descuentos").update({ concepto, importe }).eq("id", id).select().single()
        : await sb.from("descuentos").insert({ usuario_id: pid, lunes: ymd(estado.infLunes), concepto, importe }).select().single();
      if (res.error) return aviso(errorTxt(res.error), true);
      el.dataset.id = res.data.id;
      pintarInforme();
    };
    el.addEventListener("change", (e) => { if (!e.target.classList.contains("a-x")) encolar(el, guardar); });
    el.querySelector(".a-x").onclick = () => encolar(el, async () => {
      if (el.dataset.id) { const { error } = await sb.from("descuentos").delete().eq("id", el.dataset.id); if (error) return aviso(errorTxt(error), true); }
      pintarInforme();
    });
  }

  // ================================================================ EXCEL (.xlsx) como la hoja de papel
  const COLORES = {
    salmon: { suave: "FFFCE4D6", fuerte: "FFF4B6A0", texto: "FF8A3B22" },
    verde: { suave: "FFE2EFD9", fuerte: "FFB5D7A0", texto: "FF2D6A25" },
  };
  // Semanas impares (ISO) en salmón y pares en verde: 2–8 nov salmón, 9–15 nov verde…
  const colorSemana = (lunes) => (numSemana(lunes) % 2 === 1 ? COLORES.salmon : COLORES.verde);
  const etiquetaSemana = (l) => {
    const d = sumarDias(l, 6);
    return `S${numSemana(l)} · ${l.getDate()}${l.getMonth() !== d.getMonth() ? " " + MESES[l.getMonth()].slice(0, 3) : ""}–${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  };
  const CA_DIES = ["DILLUNS", "DIMARTS", "DIMECRES", "DIJOUS", "DIVENDRES", "DISSABTE", "DIUMENGE"];
  const CA_MESOS = ["GENER", "FEBRER", "MARÇ", "ABRIL", "MAIG", "JUNY", "JULIOL", "AGOST", "SETEMBRE", "OCTUBRE", "NOVEMBRE", "DESEMBRE"];
  const deMes = (m) => (/^[AEIOU]/.test(CA_MESOS[m]) ? "D'" : "DE ") + CA_MESOS[m];
  const dd = (n) => String(n).padStart(2, "0");
  const fechaPunto = (d) => `${dd(d.getDate())}.${dd(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
  function tituloSetmana(l) {
    const d = sumarDias(l, 6);
    return l.getMonth() === d.getMonth()
      ? `SETMANA DEL ${dd(l.getDate())} AL ${dd(d.getDate())} ${deMes(d.getMonth())}`
      : `SETMANA DEL ${dd(l.getDate())} ${deMes(l.getMonth())} AL ${dd(d.getDate())} ${deMes(d.getMonth())}`;
  }

  function dialogoExcel(personaId) {
    const base = lunesDe(new Date());
    const semanas = Array.from({ length: 60 }, (_, i) => sumarDias(base, 7 * (4 - i)));
    const opc = (sel) => semanas.map((l) => `<option value="${ymd(l)}" ${ymd(l) === ymd(sel) ? "selected" : ""}>${etiquetaSemana(l)}</option>`).join("");
    const trabajadoras = estado.perfiles.filter((p) => !p.es_admin || p.id === personaId);
    abrirModal("Descargar Excel", `
      <form id="form-xls">
        <label for="x-persona">Persona</label>
        <select id="x-persona"><option value="">Todas (una hoja por persona)</option>
          ${trabajadoras.map((p) => `<option value="${p.id}" ${p.id === (estado.xlsSel ? estado.xlsSel.persona : personaId) ? "selected" : ""}>${esc(nombreDe(p))}</option>`).join("")}</select>
        <div class="rejilla">
          <div><label for="x-desde">Desde la semana</label><select id="x-desde">${opc(estado.xlsSel?.desde || estado.infLunes)}</select></div>
          <div><label for="x-hasta">Hasta la semana</label><select id="x-hasta">${opc(estado.xlsSel?.hasta || estado.infLunes)}</select></div>
        </div>
        <p class="muted" style="font-size:.85rem">Una página A4 vertical por semana, lista para imprimir. Las semanas van alternando
          <span class="chip" style="background:#FCE4D6;color:#8a3b22">salmón</span> y <span class="chip" style="background:#E2EFD9;color:#2d6a25">verde</span>.</p>
        <p class="error" id="x-error"></p>
        <div class="acciones"><button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario" id="x-btn">Ver y descargar</button></div>
      </form>`);
    $("#form-xls").onsubmit = async (e) => {
      e.preventDefault();
      let desde = deYmd($("#x-desde").value), hasta = deYmd($("#x-hasta").value);
      if (desde > hasta) [desde, hasta] = [hasta, desde];
      $("#x-btn").disabled = true; $("#x-btn").textContent = "Preparando…";
      const sel = { persona: $("#x-persona").value, desde, hasta };
      try {
        const libro = await generarExcel(sel.persona, desde, hasta);
        estado.xlsSel = sel;
        mostrarPrevia(libro, () => dialogoExcel(personaId));
      } catch (err) {
        console.error(err);
        $("#x-error").textContent = "No se pudo generar el Excel: " + (err.message || err);
        $("#x-btn").disabled = false; $("#x-btn").textContent = "Ver y descargar";
      }
    };
  }

  let cargaExcelJS;
  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    cargaExcelJS = cargaExcelJS || new Promise((ok, mal) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
      sc.onload = ok; sc.onerror = () => { cargaExcelJS = null; mal(new Error("no se pudo cargar la librería de Excel. Revisa la conexión.")); };
      document.head.appendChild(sc);
    });
    return cargaExcelJS;
  }

  function guardarLibro(buf, nombre) {
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function generarExcel(personaId, desde, hasta) {
    await cargarExcelJS();
    const D = await datosSemanas(desde, hasta, personaId);
    const conDatos = new Set(D.trabajos.map((t) => t.usuario_id));
    const personas = personaId
      ? estado.perfiles.filter((p) => p.id === personaId)
      : estado.perfiles.filter((p) => conDatos.has(p.id) || (p.activo && !p.es_admin));
    const semanas = [];
    for (let l = new Date(desde); l <= hasta; l = sumarDias(l, 7)) semanas.push(new Date(l));
    const wb = construirLibro(window.ExcelJS, personas, semanas, D);
    const quien = personaId ? (personas[0]?.usuario || "persona") : "totes";
    return { wb, nombre: `fulls_${quien}_${ymd(desde)}${semanas.length > 1 ? "_a_" + ymd(hasta) : ""}.xlsx` };
  }

  // Construye el libro: una hoja por persona, una página vertical por semana
  function construirLibro(ExcelJS, personas, semanas, D) {
    const wb = new ExcelJS.Workbook();
    wb.creator = C.EMPRESA || "Control de horas";
    const fino = { style: "thin", color: { argb: "FF444444" } };
    const caja = { top: fino, left: fino, bottom: fino, right: fino };
    const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const FMT_N = '#,##0.00;-#,##0.00;""', FMT_T = '[h]:mm;;""', FMT_EUR = '#,##0.00 "€"';
    const usados = new Set();

    personas.forEach((p) => {
      let nom = (nombreDe(p) || p.usuario).replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Full";
      let n = 2; const base = nom; while (usados.has(nom.toLowerCase())) nom = `${base} ${n++}`;
      usados.add(nom.toLowerCase());
      const ws = wb.addWorksheet(nom, {
        pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
        views: [{ showGridLines: false }],
      });
      // A espacio | B-C cliente | D hora | E totals | F espacio | G-H cliente | I hora | J totals
      ws.columns = [3, 14, 11, 8, 11, 3, 14, 11, 8, 11].map((w) => ({ width: w }));
      let fila = 1;

      semanas.forEach((lunes, si) => {
        const col = colorSemana(lunes);
        const sp = semanaPersona(D, p, lunes);
        const r0 = fila;
        const precioRef = `$J$${r0}`;
        const set = (r, c, v, est = {}) => {
          const cell = ws.getCell(r, c);
          cell.value = v;
          if (est.bold || est.color || est.size) cell.font = { bold: !!est.bold, size: est.size || 11, color: est.color ? { argb: est.color } : undefined };
          if (est.fill) cell.fill = fill(est.fill);
          if (est.caja) cell.border = caja;
          if (est.fmt) cell.numFmt = est.fmt;
          cell.alignment = { vertical: "middle", horizontal: est.al || (typeof v === "number" || (v && v.formula) ? "right" : "left") };
          return cell;
        };

        // Cabecera: NOM / ANY / PREU HORA
        set(r0, 2, "NOM:", { bold: true, al: "right" });
        ws.mergeCells(r0, 3, r0, 4); set(r0, 3, (p.nombre || p.usuario).toUpperCase(), { bold: true, fill: col.fuerte, al: "center" });
        set(r0, 5, `ANY: ${lunes.getFullYear()}`, { bold: true });
        ws.mergeCells(r0, 7, r0, 9); set(r0, 7, "PREU HORA:", { bold: true, al: "right" });
        set(r0, 10, Number(p.precio_hora) || 0, { bold: true, fmt: FMT_EUR, fill: col.suave });
        ws.mergeCells(r0 + 1, 2, r0 + 1, 10);
        set(r0 + 1, 2, tituloSetmana(lunes), { bold: true, fill: col.fuerte, al: "center", size: 12 });
        ws.getRow(r0 + 1).height = 20;

        // Bloques de días
        const totalesHoras = [], totalesEur = [];
        const bloque = (cBase, iDia, r, minFilas) => {
          const d = sumarDias(lunes, iDia), k = ymd(d);
          const ls = sp.ls.filter((t) => t.fecha === k);
          const nf = Math.max(minFilas, ls.length);
          set(r, cBase, CA_DIES[iDia], { bold: true });
          set(r, cBase + 1, fechaPunto(d), { bold: true, fill: col.suave, al: "center" });
          set(r, cBase + 2, "HORA", { bold: true, fill: col.suave, al: "center" });
          set(r, cBase + 3, "TOTALS", { bold: true, fill: col.fuerte, al: "center" });
          for (let i = 0; i < nf; i++) {
            const t = ls[i], rr = r + 1 + i;
            const h = t ? Number(t.minutos) / 1440 : null; // tiempo de Excel (fracción de día) → se ve como 5:45
            ws.mergeCells(rr, cBase, rr, cBase + 1);
            set(rr, cBase, t ? nombreCliente(t).toUpperCase() : "", { al: "center" });
            const ch = ws.getCell(rr, cBase + 2).address;
            set(rr, cBase + 2, h, { fmt: FMT_T });
            set(rr, cBase + 3, { formula: `IF(${ch}="","",ROUND(${ch}*24*${precioRef},2))`, result: t ? Math.round((Number(t.minutos) / 60) * (Number(p.precio_hora) || 0) * 100) / 100 : "" }, { fmt: FMT_N });
          }
          const rt = r + 1 + nf;
          const hIni = ws.getCell(r + 1, cBase + 2).address, hFin = ws.getCell(rt - 1, cBase + 2).address;
          const eIni = ws.getCell(r + 1, cBase + 3).address, eFin = ws.getCell(rt - 1, cBase + 3).address;
          const sumH = ls.reduce((a, t) => a + Number(t.minutos), 0) / 60;
          set(rt, cBase + 2, { formula: `SUM(${hIni}:${hFin})`, result: sumH / 24 }, { caja: true, bold: true, fmt: "[h]:mm" });
          set(rt, cBase + 3, { formula: `SUM(${eIni}:${eFin})`, result: Math.round(sumH * (Number(p.precio_hora) || 0) * 100) / 100 }, { caja: true, bold: true, fmt: FMT_EUR });
          totalesHoras.push(ws.getCell(rt, cBase + 2).address); totalesEur.push(ws.getCell(rt, cBase + 3).address);
          return rt + 2;
        };
        let rl = r0 + 3, rr = r0 + 3;
        for (let i = 0; i < 4; i++) rl = bloque(2, i, rl, 8);          // DILLUNS – DIJOUS
        rr = bloque(7, 4, rr, 8);                                       // DIVENDRES
        rr = bloque(7, 5, rr, 3);                                       // DISSABTE
        rr = bloque(7, 6, rr, 3);                                       // DIUMENGE

        // Resumen a la derecha (como en la hoja de papel)
        const c = sp.c;
        const rHores = rr, rTotal = rr + 1;
        ws.mergeCells(rHores, 7, rHores, 8); set(rHores, 7, "HORES:", { bold: true, caja: true, al: "center" });
        ws.mergeCells(rHores, 9, rHores, 10);
        set(rHores, 9, { formula: totalesHoras.join("+"), result: c.horas / 24 }, { bold: true, fill: col.suave, fmt: "[h]:mm", al: "center" });
        ws.mergeCells(rTotal, 7, rTotal, 8); set(rTotal, 7, "TOTAL:", { bold: true, caja: true, al: "center" });
        ws.mergeCells(rTotal, 9, rTotal, 10);
        set(rTotal, 9, { formula: totalesEur.join("+"), result: c.bruto }, { bold: true, fill: col.fuerte, fmt: FMT_EUR, al: "center" });
        let r = rTotal + 2;
        const restas = [];
        if (c.contrato) {
          ws.mergeCells(r, 7, r, 9);
          set(r, 7, `CONTRACTE (${fmtH(Math.min(c.horas, c.contrato))} h × ${num2(c.precio)} €)`, { al: "right" });
          set(r, 10, { formula: `ROUND(MIN(${ws.getCell(rHores, 9).address}*24,${c.contrato})*${precioRef},2)`, result: Math.round(Math.min(c.horas, c.contrato) * c.precio * 100) / 100 }, { fmt: FMT_EUR });
          restas.push(ws.getCell(r, 10).address); r++;
        }
        const cobros = sp.ls.filter((t) => Number(t.cobrado));
        if (cobros.length || sp.ants.length) { set(r, 7, "COBRAT / ANTICIPS:", { bold: true }); r++; }
        cobros.forEach((t) => {
          ws.mergeCells(r, 7, r, 9); set(r, 7, nombreCliente(t).toUpperCase(), { al: "right" });
          set(r, 10, Number(t.cobrado), { fmt: FMT_EUR }); restas.push(ws.getCell(r, 10).address); r++;
        });
        sp.ants.forEach((d) => {
          ws.mergeCells(r, 7, r, 9); set(r, 7, (d.concepto || "ANTICIP").toUpperCase(), { al: "right" });
          set(r, 10, Number(d.importe), { fmt: FMT_EUR }); restas.push(ws.getCell(r, 10).address); r++;
        });
        if (restas.length) {
          ws.mergeCells(r, 7, r, 9); set(r, 7, "TOTAL A DESCOMPTAR", { bold: true, al: "right" });
          set(r, 10, { formula: `SUM(${restas.join(",")})`, result: Math.round((c.bruto - c.importe + c.descuentos) * 100) / 100 }, { bold: true, fmt: FMT_EUR, caja: true });
          r++;
        }
        r++;
        ws.mergeCells(r, 7, r, 8); set(r, 7, c.apagar >= 0 ? "A PAGAR:" : "A RETORNAR:", { bold: true, caja: true, al: "center", size: 12 });
        ws.mergeCells(r, 9, r, 10);
        set(r, 9, { formula: `ABS(${ws.getCell(rTotal, 9).address}${restas.length ? "-SUM(" + restas.join(",") + ")" : ""})`, result: Math.abs(c.apagar) }, { bold: true, fill: col.fuerte, fmt: FMT_EUR, al: "center", size: 12, color: "FFB3261E" });
        ws.getRow(r).height = 22;
        r += 2;
        set(r, 7, "OBSERVACIONS:", { bold: true });
        ws.mergeCells(r + 1, 7, r + 3, 10);
        const obs = set(r + 1, 7, sp.ficha.observaciones || "", {});
        obs.alignment = { vertical: "top", horizontal: "left", wrapText: true };
        rr = r + 4;

        // Pie: PREPARAT / ENTREGAT
        const rp = Math.max(rl, rr) + 1;
        set(rp, 4, "PREPARAT:", { bold: true, al: "right" }); ws.mergeCells(rp, 5, rp, 6); set(rp, 5, fechaPunto(new Date()));
        set(rp + 1, 4, "ENTREGAT:", { bold: true, al: "right" }); ws.mergeCells(rp + 1, 5, rp + 1, 6);
        set(rp + 1, 5, sp.ficha.entregado ? fechaPunto(deYmd(sp.ficha.entregado)) : "");
        set(rp + 1, 8, "SIGNATURA:", { bold: true, al: "right" });
        ws.mergeCells(rp + 1, 9, rp + 1, 10); ws.getCell(rp + 1, 9).border = { bottom: fino };
        fila = rp + 3;
        if (si < semanas.length - 1) ws.getRow(rp + 2).addPageBreak();
      });
    });
    if (!personas.length) wb.addWorksheet("Buit").getCell("A1").value = "No hi ha dades";
    return wb;
  }

  // Excel mensual por cliente: horas, visitas y lo cobrado en efectivo (sección Clientes)
  async function excelClientesMes() {
    await cargarExcelJS();
    const mes = estado.cliMes;
    const wb = new ExcelJS.Workbook();
    const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const EUR = '#,##0.00 "€"';
    const ps = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    const cabecera = (fila) => { fila.font = { bold: true, color: { argb: "FFFFFFFF" } }; fila.eachCell((c) => { c.fill = fill("FF1F3A5F"); c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; }); fila.height = 30; };
    const lista = statsClientes().filter((s) => s.visitas).sort((a, b) => a.c.nombre.localeCompare(b.c.nombre, "es"));
    const titulo = `${CA_MESOS[mes.getMonth()]} ${mes.getFullYear()}`;

    const res = wb.addWorksheet("Resum", { pageSetup: ps, views: [{ state: "frozen", ySplit: 3 }] });
    res.columns = [{ width: 30 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 36 }];
    res.mergeCells("A1:E1"); res.getCell("A1").value = `HORES PER CLIENT · ${titulo}`; res.getCell("A1").font = { bold: true, size: 14 };
    const cab = res.getRow(3); cab.values = ["CLIENT", "HORES", "VISITES", "COBRAT EN EFECTIU", "QUI HI HA ANAT"]; cabecera(cab);
    lista.forEach((s, i) => {
      const row = res.addRow([s.c.nombre, s.min / 1440, s.visitas, s.cobrado || null, [...s.gente].map((id) => nombreDe(estado.perfiles.find((p) => p.id === id))).join(", ")]);
      if (i % 2) row.eachCell((c) => (c.fill = fill("FFF3F5F8")));
    });
    const ult = 3 + lista.length;
    const tMin = lista.reduce((x, s) => x + s.min, 0), tVis = lista.reduce((x, s) => x + s.visitas, 0), tCob = r2(lista.reduce((x, s) => x + s.cobrado, 0));
    const tr = res.addRow(["TOTAL", { formula: `SUM(B4:B${ult})`, result: tMin / 1440 }, { formula: `SUM(C4:C${ult})`, result: tVis }, { formula: `SUM(D4:D${ult})`, result: tCob }, ""]);
    tr.font = { bold: true }; tr.eachCell((c) => { c.fill = fill("FFE3E7ED"); c.border = { top: { style: "medium" } }; });
    res.getColumn(2).numFmt = "[h]:mm"; res.getColumn(3).alignment = { horizontal: "center" }; res.getColumn(4).numFmt = EUR;

    const det = wb.addWorksheet("Detall", { pageSetup: ps, views: [{ state: "frozen", ySplit: 1 }] });
    det.columns = [{ width: 28 }, { width: 12 }, { width: 24 }, { width: 9 }, { width: 16 }];
    const cab2 = det.getRow(1); cab2.values = ["CLIENT", "DATA", "TREBALLADORA", "HORES", "COBRAT EN EFECTIU"]; cabecera(cab2);
    lista.forEach((s) => {
      s.lista.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).forEach((t) => {
        det.addRow([s.c.nombre, deYmd(t.fecha), nombreDe(estado.perfiles.find((p) => p.id === t.usuario_id)), t.minutos / 1440, Number(t.cobrado) || null]);
      });
      const sub = det.addRow([`TOTAL ${s.c.nombre}`, "", "", s.min / 1440, s.cobrado || null]);
      sub.font = { bold: true }; sub.eachCell((c) => (c.fill = fill("FFE2EFD9")));
      det.addRow([]);
    });
    det.getColumn(2).numFmt = "dd/mm/yyyy"; det.getColumn(4).numFmt = "[h]:mm"; det.getColumn(5).numFmt = EUR;

    return { wb, nombre: `clients_${mes.getFullYear()}-${dd(mes.getMonth() + 1)}.xlsx` };
  }

  // ================================================================ VISTA PREVIA DEL EXCEL
  function valorCelda(cell) {
    let v = cell.value;
    if (v && typeof v === "object" && !(v instanceof Date)) v = "result" in v ? v.result : v.richText ? v.richText.map((r) => r.text).join("") : v.text ?? "";
    if (v === null || v === undefined || v === "") return "";
    const f = cell.numFmt || "";
    if (v instanceof Date) return `${dd(v.getDate())}/${dd(v.getMonth() + 1)}/${v.getFullYear()}`;
    if (typeof v === "number") {
      if (v === 0 && /;""\s*$|;;""/.test(f)) return "";
      if (f.includes("[h]:mm")) return fmtH(v * 24);
      if (f.includes("dd/mm")) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }
      const dec = f.includes(".00") ? 2 : 0, max = f.includes(".00") || f.includes(".##") ? 2 : 2;
      const n = v.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: max });
      return f.includes("€") ? n + " €" : n;
    }
    return String(v);
  }

  function renderHoja(ws) {
    const nCols = Math.max(1, ws.columnCount), nFilas = ws.rowCount;
    const anchos = Array.from({ length: nCols }, (_, i) => Math.round((ws.getColumn(i + 1).width || 9) * 7.2));
    const rejilla = ws.views?.[0]?.showGridLines !== false;
    const merges = new Map(), tapadas = new Set();
    (ws.model.merges || []).forEach((rng) => {
      const [a, b] = rng.split(":"); const ca = ws.getCell(a), cb = ws.getCell(b);
      merges.set(`${ca.row},${ca.col}`, { rs: cb.row - ca.row + 1, cs: cb.col - ca.col + 1 });
      for (let r = ca.row; r <= cb.row; r++) for (let c = ca.col; c <= cb.col; c++) if (r !== ca.row || c !== ca.col) tapadas.add(`${r},${c}`);
    });
    const cortes = new Set((ws.rowBreaks || []).map((b) => b.id));
    const linea = (b) => (!b || !b.style ? "" : `${b.style === "medium" || b.style === "thick" ? 2 : 1}px solid #444`);
    const colgroup = `<colgroup>${anchos.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;
    let paginas = [], filas = "";
    for (let r = 1; r <= nFilas; r++) {
      const row = ws.getRow(r);
      let tds = "";
      for (let c = 1; c <= nCols; c++) {
        const k = `${r},${c}`;
        if (tapadas.has(k)) continue;
        const cell = row.getCell(c), m = merges.get(k);
        const st = [];
        const fg = cell.fill?.fgColor?.argb; if (fg) st.push(`background:#${fg.slice(-6)}`);
        const fo = cell.font || {};
        if (fo.bold) st.push("font-weight:700");
        if (fo.italic) st.push("font-style:italic");
        if (fo.size) st.push(`font-size:${Math.round(fo.size * 1.2)}px`);
        if (fo.color?.argb) st.push(`color:#${fo.color.argb.slice(-6)}`);
        const al = cell.alignment || {};
        if (al.horizontal) st.push(`text-align:${al.horizontal === "centerContinuous" ? "center" : al.horizontal}`);
        if (al.vertical === "top") st.push("vertical-align:top");
        if (al.wrapText) st.push("white-space:normal");
        const bd = cell.border || {};
        ["top", "right", "bottom", "left"].forEach((lado) => { const l = linea(bd[lado]); if (l) st.push(`border-${lado}:${l}`); });
        const v = valorCelda(cell);
        if (typeof (cell.value?.result ?? cell.value) === "number" && !al.horizontal) st.push("text-align:right");
        tds += `<td${m ? ` rowspan="${m.rs}" colspan="${m.cs}"` : ""} style="${st.join(";")}">${esc(v)}</td>`;
      }
      const alto = row.height ? `height:${Math.round(row.height * 1.33)}px` : "";
      filas += `<tr style="${alto}">${tds}</tr>`;
      if (cortes.has(r)) { paginas.push(filas); filas = ""; }
    }
    if (filas) paginas.push(filas);
    const vertical = ws.pageSetup?.orientation !== "landscape";
    return paginas.map((f, i) => `<div class="previa-pagina ${vertical ? "vertical" : "horizontal"}">
      <table class="previa-tabla ${rejilla ? "con-rejilla" : ""}">${colgroup}<tbody>${f}</tbody></table>
      <div class="previa-num">Página ${i + 1} de ${paginas.length}</div></div>`).join("");
  }

  function mostrarPrevia(libro, volver) {
    const hojas = libro.wb.worksheets;
    abrirModal("Vista previa", `
      <div class="previa-cab">
        <div class="previa-tabs" role="tablist">${hojas.map((ws, i) => `<button type="button" class="btn btn-sm ${i ? "" : "btn-primario"}" data-hoja="${i}" role="tab">${esc(ws.name)}</button>`).join("")}</div>
        <span class="muted" style="font-size:.85rem">${esc(libro.nombre)}</span>
      </div>
      <div class="previa" id="previa"></div>
      <div class="acciones">
        ${volver ? `<button type="button" class="btn izq" id="pv-volver">‹ Cambiar semanas o persona</button>` : ""}
        <button type="button" class="btn" data-cerrar>Cerrar</button>
        <button type="button" class="btn btn-primario" id="pv-bajar">Descargar Excel</button>
      </div>`);
    $("#modal .modal-caja").classList.add("modal-ancha");
    const ver = (i) => {
      $("#previa").innerHTML = renderHoja(hojas[i]);
      document.querySelectorAll("[data-hoja]").forEach((b) => b.classList.toggle("btn-primario", Number(b.dataset.hoja) === i));
      $("#previa").scrollTop = 0;
    };
    document.querySelectorAll("[data-hoja]").forEach((b) => (b.onclick = () => ver(Number(b.dataset.hoja))));
    ver(0);
    if (volver) $("#pv-volver").onclick = volver;
    $("#pv-bajar").onclick = async () => {
      $("#pv-bajar").disabled = true;
      guardarLibro(await libro.wb.xlsx.writeBuffer(), libro.nombre);
      cerrarModal();
    };
  }

  function descargarCSV(nombre, filas) {
    const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const texto = filas.map((f) => f.map(q).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ================================================================ INICIO
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && estado.yo) { estado.yo = null; mostrarLogin(); } });
  arrancar();
})();
