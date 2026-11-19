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
    $("#modal-titulo").textContent = titulo;
    $("#modal-cuerpo").innerHTML = html;
    $("#modal").hidden = false;
    const f = $("#modal-cuerpo input:not([readonly]), #modal-cuerpo select");
    if (f) setTimeout(() => f.focus(), 30);
  }
  function cerrarModal() { $("#modal").hidden = true; $("#modal-cuerpo").innerHTML = ""; }
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
    if (estado.yo?.es_admin) s.push(["usuarios", "Usuarios"], ["informes", "Informes semanales"]);
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
    ({ calendario: vistaCalendario, ficha: vistaFicha, usuarios: vistaUsuarios, informes: vistaInformes })[v]();
  }

  // ================================================================ SEMANA (L–D) · clientes por día
  const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const eur = (n) => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const fmtMin = (m) => fmtH((Number(m) || 0) / 60);

  // Cuentas de la semana: horas hechas − horas de contrato = horas extra × precio
  function cuentas(minutos, p) {
    const horas = (Number(minutos) || 0) / 60;
    const contrato = Number(p.horas_semanales) || 0;
    const precio = Number(p.precio_hora) || 0;
    const dif = horas - contrato;
    const extra = Math.max(0, dif);
    return { horas, contrato, precio, dif, extra, faltan: Math.max(0, -dif), importe: Math.round(extra * precio * 100) / 100 };
  }

  async function vistaCalendario() {
    const yo = estado.yo;
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
      <datalist id="lista-clientes"></datalist>
      <p class="muted ayuda">Escribe el cliente y el tiempo. Se guarda solo al salir del campo.</p>`;

    $("#cal-prev").onclick = () => { estado.calLunes = sumarDias(estado.calLunes, -7); pintarCalendario(); };
    $("#cal-next").onclick = () => { estado.calLunes = sumarDias(estado.calLunes, 7); pintarCalendario(); };
    $("#cal-hoy").onclick = () => { estado.calLunes = lunesDe(new Date()); pintarCalendario(); };
    if (yo.es_admin) $("#cal-usuario").onchange = (e) => { estado.calUsuario = e.target.value; pintarCalendario(); };
    pintarCalendario();
  }

  function perfilCal() {
    return estado.calUsuario === estado.yo.id ? estado.yo : estado.perfiles.find((p) => p.id === estado.calUsuario) || estado.yo;
  }

  async function cargarClientes() {
    const { data } = await sb.from("trabajos").select("cliente").eq("usuario_id", estado.calUsuario).order("fecha", { ascending: false }).limit(1000);
    const vistos = new Map();
    (data || []).forEach((r) => { const k = r.cliente.trim().toLowerCase(); if (!vistos.has(k)) vistos.set(k, r.cliente.trim()); });
    $("#lista-clientes").innerHTML = [...vistos.values()].sort((a, b) => a.localeCompare(b, "es")).map((c) => `<option value="${esc(c)}"></option>`).join("");
  }

  function lineaHTML(t) {
    const min = t ? Number(t.minutos) : 0;
    const h = t ? Math.floor(min / 60) : "", m = t ? min % 60 : 0;
    const opcionesMin = Array.from({ length: 12 }, (_, i) => i * 5).map((v) => `<option value="${v}" ${v === m ? "selected" : ""}>${String(v).padStart(2, "0")}</option>`).join("");
    return `<div class="linea" data-id="${t ? t.id : ""}">
      <input class="l-cli" list="lista-clientes" maxlength="80" placeholder="Cliente" aria-label="Cliente" value="${t ? esc(t.cliente) : ""}">
      <span class="l-tiempo">
        <input class="l-h" type="number" inputmode="numeric" min="0" max="16" placeholder="0" aria-label="Horas" value="${h}"><span class="muted">h</span>
        <select class="l-m" aria-label="Minutos">${opcionesMin}</select><span class="muted">min</span>
      </span>
      <button type="button" class="btn btn-sm btn-fantasma l-borrar" aria-label="Quitar cliente">✕</button>
      <span class="l-estado"></span>
    </div>`;
  }

  async function pintarCalendario() {
    const lunes = estado.calLunes, dom = sumarDias(lunes, 6);
    $("#cal-titulo").textContent = `Semana ${numSemana(lunes)}`;
    $("#cal-sub").textContent = rangoSemana(lunes);

    const { data, error } = await sb.from("trabajos").select("*")
      .eq("usuario_id", estado.calUsuario).gte("fecha", ymd(lunes)).lte("fecha", ymd(dom)).order("id");
    if (error) return aviso(errorTxt(error), true);
    estado.trabajos = new Map(data.map((t) => [String(t.id), t]));
    cargarClientes();

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
        card.querySelector(".lineas .linea:last-child .l-cli").focus();
      };
      card.querySelectorAll(".linea").forEach(prepararLinea);
    });
    pintarTotales();
  }

  function prepararLinea(el) {
    el.addEventListener("change", (e) => { if (!e.target.classList.contains("l-borrar")) encolar(el, guardarLinea); });
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
    const cliente = el.querySelector(".l-cli").value.trim();
    const minutos = (parseInt(el.querySelector(".l-h").value, 10) || 0) * 60 + (parseInt(el.querySelector(".l-m").value, 10) || 0);
    const id = el.dataset.id;
    if (!cliente && !minutos) { if (id) return borrarLinea(el, true); return marcarLinea(el, ""); }
    if (!cliente) return marcarLinea(el, "Falta el cliente", true);
    if (!minutos) return marcarLinea(el, "Falta el tiempo", true);
    if (minutos > 16 * 60) return marcarLinea(el, "Máximo 16 h", true);
    const ant = id ? estado.trabajos.get(id) : null;
    if (ant && ant.cliente === cliente && Number(ant.minutos) === minutos) return;
    const res = id
      ? await sb.from("trabajos").update({ cliente, minutos }).eq("id", id).select().single()
      : await sb.from("trabajos").insert({ usuario_id: perfilCal().id, fecha, cliente, minutos }).select().single();
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
      el.dataset.id = ""; el.querySelector(".l-cli").value = ""; el.querySelector(".l-h").value = ""; el.querySelector(".l-m").value = "0";
      marcarLinea(el, id ? "Borrado" : "");
    } else el.remove();
    pintarTotales();
  }

  function pintarTotales() {
    const porDia = new Map();
    let total = 0;
    for (const t of estado.trabajos.values()) { porDia.set(t.fecha, (porDia.get(t.fecha) || 0) + Number(t.minutos)); total += Number(t.minutos); }
    document.querySelectorAll(".dia-card").forEach((c) => {
      const m = porDia.get(c.dataset.fecha) || 0;
      c.querySelector(".dia-total").innerHTML = m ? fmtMin(m) + " h" : '<span class="cero">0:00 h</span>';
    });
    const c = cuentas(total, perfilCal());
    $("#sem-pie").innerHTML = `
      <div><span class="etq">Horas hechas</span><span class="val num">${fmtH(c.horas)}</span></div>
      <div><span class="etq">− Contrato</span><span class="val num">${fmtH(c.contrato)}</span></div>
      <div class="${c.dif >= 0 ? "pie-ok" : ""}"><span class="etq">${c.dif >= 0 ? "= Horas extra" : "= Faltan"}</span><span class="val num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${fmtH(c.dif >= 0 ? c.extra : c.faltan)}</span></div>
      <div class="pie-dinero"><span class="etq">Extras × ${eur(c.precio)}/h</span><span class="val num">${eur(c.importe)}</span></div>`;
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

  // ================================================================ INFORMES SEMANALES (master)
  async function vistaInformes() {
    await cargarPerfiles();
    $("#contenido").innerHTML = `
      <div class="barra no-imprimir">
        <button class="btn btn-sm" id="inf-prev" aria-label="Semana anterior">‹</button>
        <button class="btn btn-sm" id="inf-next" aria-label="Semana siguiente">›</button>
        <button class="btn btn-sm btn-fantasma" id="inf-hoy">Esta semana</button>
        <button class="btn btn-sm btn-fantasma" id="inf-ant">Semana pasada</button>
        <span class="espacio"></span>
        <button class="btn btn-sm" id="inf-csv">Descargar Excel (todos)</button>
        <button class="btn btn-sm" id="inf-print">Imprimir / PDF (todos)</button>
      </div>
      <div><h1 id="inf-titulo"></h1><p class="muted" id="inf-sub" style="margin:4px 0 0"></p></div>
      <div class="resumen" id="inf-resumen"></div>
      <div class="tabla-envoltura" id="inf-tabla"></div>
      <section class="detalle" id="inf-detalle"></section>
      <section class="tarjeta" id="inf-clientes"></section>
      <section class="tarjeta no-imprimir" id="inf-historico"></section>`;
    const mover = (n) => { estado.infLunes = sumarDias(estado.infLunes, n); pintarInforme(); };
    $("#inf-prev").onclick = () => mover(-7);
    $("#inf-next").onclick = () => mover(7);
    $("#inf-hoy").onclick = () => { estado.infLunes = lunesDe(new Date()); pintarInforme(); };
    $("#inf-ant").onclick = () => { estado.infLunes = sumarDias(lunesDe(new Date()), -7); pintarInforme(); };
    $("#inf-print").onclick = () => { document.body.classList.remove("imprimir-ficha"); window.print(); };
    pintarInforme();
  }

  async function pintarInforme() {
    const lunes = estado.infLunes, dom = sumarDias(lunes, 6);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    const kd = dias.map(ymd);
    $("#inf-titulo").textContent = `Informe semana ${numSemana(lunes)}`;
    $("#inf-sub").textContent = rangoSemana(lunes);

    const desdeHist = sumarDias(lunes, -7 * 7);
    const { data, error } = await sb.from("trabajos").select("*").gte("fecha", ymd(desdeHist)).lte("fecha", ymd(dom)).order("fecha").order("id");
    if (error) return aviso(errorTxt(error), true);

    const semana = data.filter((t) => t.fecha >= kd[0]);
    const conHoras = new Set(semana.map((t) => t.usuario_id));
    const personas = estado.perfiles.filter((p) => conHoras.has(p.id) || (p.activo && !p.es_admin));
    const minDia = (pid, k) => semana.filter((t) => t.usuario_id === pid && t.fecha === k).reduce((a, t) => a + Number(t.minutos), 0);

    const totDia = Array(7).fill(0);
    let tHoras = 0, tContrato = 0, tExtra = 0, tImporte = 0;
    const filas = personas.map((p) => {
      let min = 0;
      const celdas = kd.map((k, i) => { const m = minDia(p.id, k); min += m; totDia[i] += m; return `<td class="num ${esFinde(dias[i]) ? "finde" : ""}">${m ? fmtMin(m) : '<span class="cero">·</span>'}</td>`; }).join("");
      const c = cuentas(min, p);
      tHoras += c.horas; tContrato += c.contrato; tExtra += c.extra; tImporte += c.importe;
      return { p, min, c, html: `<tr><td><b>${esc(nombreDe(p))}</b></td>${celdas}
        <td class="num"><b>${fmtH(c.horas)}</b></td><td class="num muted">${fmtH(c.contrato)}</td>
        <td class="num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${c.dif >= 0 ? fmtH(c.extra) : "−" + fmtH(c.faltan)}</td>
        <td class="num muted">${eur(c.precio)}</td><td class="num"><b>${eur(c.importe)}</b></td></tr>` };
    });

    $("#inf-tabla").innerHTML = `<table>
      <thead><tr><th>Persona</th>${dias.map((d) => `<th class="num ${esFinde(d) ? "finde" : ""}">${diaCorto(d)}</th>`).join("")}
        <th class="num">Total</th><th class="num">Contrato</th><th class="num">Extra</th><th class="num">€/hora</th><th class="num">Importe extra</th></tr></thead>
      <tbody>${filas.map((f) => f.html).join("") || `<tr><td colspan="13" class="vacio">No hay usuarios activos.</td></tr>`}</tbody>
      <tfoot><tr><td>Total</td>${totDia.map((m, i) => `<td class="num ${esFinde(dias[i]) ? "finde" : ""}">${fmtMin(m)}</td>`).join("")}
        <td class="num">${fmtH(tHoras)}</td><td class="num">${fmtH(tContrato)}</td><td class="num dif-pos">${fmtH(tExtra)}</td><td></td><td class="num">${eur(tImporte)}</td></tr></tfoot>
    </table>`;

    const sinApuntar = personas.filter((p) => p.activo && !semana.some((t) => t.usuario_id === p.id));
    $("#inf-resumen").innerHTML = `
      <div class="dato"><div class="etq">Horas hechas</div><div class="val">${fmtH(tHoras)}</div><div class="sub">${personas.length} personas</div></div>
      <div class="dato"><div class="etq">Horas de contrato</div><div class="val">${fmtH(tContrato)}</div><div class="sub">se restan del total</div></div>
      <div class="dato"><div class="etq">Horas extra</div><div class="val dif-pos">${fmtH(tExtra)}</div><div class="sub">por encima del contrato</div></div>
      <div class="dato"><div class="etq">A pagar por extras</div><div class="val">${eur(tImporte)}</div><div class="sub">${sinApuntar.length ? "Sin apuntar: " + sinApuntar.map((p) => esc(p.nombre || p.usuario)).join(", ") : "todos han apuntado"}</div></div>`;

    // Ficha semanal de cada persona
    const lineasPersona = (pid) => semana.filter((t) => t.usuario_id === pid);
    $("#inf-detalle").innerHTML = `<h2 class="no-imprimir">Fichas semanales por persona</h2>` + filas.map(({ p, c }) => {
      const ls = lineasPersona(p.id);
      const cuerpo = kd.map((k, i) => {
        const delDia = ls.filter((t) => t.fecha === k);
        const sub = delDia.reduce((a, t) => a + Number(t.minutos), 0);
        const fd = esFinde(dias[i]) ? "finde" : "";
        if (!delDia.length) return `<tr><td class="${fd}">${diaCorto(dias[i])}</td><td class="cero">—</td><td class="num cero">0:00</td><td class="num cero"></td></tr>`;
        return delDia.map((t, j) => `<tr class="${j === 0 ? "dia-ini" : ""}"><td class="${fd}">${j === 0 ? diaCorto(dias[i]) : ""}</td><td>${esc(t.cliente)}</td><td class="num">${fmtMin(t.minutos)}</td>
          <td class="num">${j === delDia.length - 1 ? "<b>" + fmtMin(sub) + "</b>" : ""}</td></tr>`).join("");
      }).join("");
      return `
      <div class="detalle-persona tarjeta" data-persona="${p.id}">
        <div class="barra">
          <h3>${esc(nombreDe(p))}</h3>
          <span class="espacio"></span>
          <span class="no-imprimir"><button class="btn btn-sm" data-csv="${p.id}">Descargar Excel</button>
          <button class="btn btn-sm" data-imprimir="${p.id}">Imprimir / PDF</button></span>
        </div>
        <p class="solo-imprimir">${esc(rangoSemana(lunes))} (semana ${numSemana(lunes)})${p.dni ? " · DNI/NIE " + esc(p.dni) : ""}</p>
        <div class="tabla-envoltura"><table class="tabla-ficha">
          <thead><tr><th>Día</th><th>Cliente</th><th class="num">Tiempo</th><th class="num">Total día</th></tr></thead>
          <tbody>${cuerpo}</tbody>
        </table></div>
        <div class="cuentas">
          <div><span>Horas hechas</span><b class="num">${fmtH(c.horas)}</b></div>
          <div><span>− Horas de contrato</span><b class="num">${fmtH(c.contrato)}</b></div>
          <div><span>= ${c.dif >= 0 ? "Horas extra" : "Faltan"}</span><b class="num ${c.dif >= 0 ? "dif-pos" : "dif-neg"}">${fmtH(c.dif >= 0 ? c.extra : c.faltan)}</b></div>
          <div class="total"><span>Importe extras (${fmtH(c.extra)} × ${eur(c.precio)})</span><b class="num">${eur(c.importe)}</b></div>
        </div>
        <div class="firmas solo-imprimir"><div>Firma del trabajador</div><div>Firma de la empresa</div></div>
      </div>`;
    }).join("");

    const fichaCSV = (p) => {
      const ls = lineasPersona(p.id);
      const c = cuentas(ls.reduce((a, t) => a + Number(t.minutos), 0), p);
      return [
        ["Ficha semanal", nombreDe(p)],
        ["Semana", `${numSemana(lunes)} · ${rangoSemana(lunes)}`],
        [],
        ["Día", "Fecha", "Cliente", "Tiempo (h:mm)", "Horas (decimal)"],
        ...ls.map((t) => [diaCorto(deYmd(t.fecha)), t.fecha, t.cliente, fmtMin(t.minutos), fmtDec(t.minutos / 60)]),
        [],
        ["Horas hechas", "", "", fmtH(c.horas), fmtDec(c.horas)],
        ["Horas de contrato", "", "", fmtH(c.contrato), fmtDec(c.contrato)],
        [c.dif >= 0 ? "Horas extra" : "Faltan", "", "", fmtH(c.dif >= 0 ? c.extra : c.faltan), fmtDec(c.dif >= 0 ? c.extra : c.faltan)],
        ["Precio hora", "", "", "", fmtDec(c.precio)],
        ["Importe extras (€)", "", "", "", fmtDec(c.importe)],
      ];
    };
    document.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => {
      const p = estado.perfiles.find((x) => x.id === b.dataset.csv);
      descargarCSV(`ficha_${p.usuario}_semana_${ymd(lunes)}.csv`, fichaCSV(p));
    }));
    document.querySelectorAll("[data-imprimir]").forEach((b) => (b.onclick = () => {
      document.querySelectorAll(".detalle-persona").forEach((el) => el.classList.toggle("seleccionada", el.dataset.persona === b.dataset.imprimir));
      document.body.classList.add("imprimir-ficha");
      window.print();
      setTimeout(() => document.body.classList.remove("imprimir-ficha"), 500);
    }));

    // Horas por cliente (útil para facturar)
    const porCliente = new Map();
    semana.forEach((t) => {
      const k = t.cliente.trim().toLowerCase();
      const v = porCliente.get(k) || { nombre: t.cliente.trim(), min: 0, gente: new Set() };
      v.min += Number(t.minutos); v.gente.add(t.usuario_id); porCliente.set(k, v);
    });
    const listaCli = [...porCliente.values()].sort((a, b) => b.min - a.min);
    $("#inf-clientes").innerHTML = `<h2>Horas por cliente</h2>${listaCli.length ? `<div class="tabla-envoltura"><table>
      <thead><tr><th>Cliente</th><th class="num">Horas</th><th>Quién</th></tr></thead>
      <tbody>${listaCli.map((v) => `<tr><td>${esc(v.nombre)}</td><td class="num">${fmtMin(v.min)}</td><td class="muted">${[...v.gente].map((id) => esc(nombreDe(estado.perfiles.find((p) => p.id === id)))).join(", ")}</td></tr>`).join("")}</tbody>
    </table></div>` : `<p class="muted">Esta semana no hay trabajos apuntados.</p>`}`;

    // Últimas 8 semanas: horas y extra
    const lunesHist = Array.from({ length: 8 }, (_, i) => sumarDias(lunes, -7 * (7 - i)));
    const minSem = (pid, l) => data.filter((t) => t.usuario_id === pid && t.fecha >= ymd(l) && t.fecha <= ymd(sumarDias(l, 6))).reduce((a, t) => a + Number(t.minutos), 0);
    $("#inf-historico").innerHTML = `<h2>Últimas 8 semanas</h2><p class="muted" style="margin:0 0 10px">Horas hechas y, debajo, horas extra.</p><div class="tabla-envoltura"><table>
      <thead><tr><th>Persona</th>${lunesHist.map((l) => `<th class="num">S${numSemana(l)}<div style="font-weight:500;text-transform:none">${l.getDate()} ${MESES[l.getMonth()].slice(0, 3)}</div></th>`).join("")}</tr></thead>
      <tbody>${personas.map((p) => `<tr><td>${esc(nombreDe(p))}</td>${lunesHist.map((l) => { const m = minSem(p.id, l); const c = cuentas(m, p); return `<td class="num">${m ? fmtMin(m) + (c.extra ? `<div class="dif-pos" style="font-size:.78rem">+${fmtH(c.extra)}</div>` : "") : '<span class="cero">·</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>`;

    // Excel de todo el equipo
    $("#inf-csv").onclick = () => {
      const filasCSV = [
        [`Informe semana ${numSemana(lunes)}`, rangoSemana(lunes)],
        [],
        ["Persona", ...dias.map(diaCorto), "Total horas", "Contrato", "Extra", "€/hora", "Importe extra (€)"],
        ...filas.map(({ p, c }) => [nombreDe(p), ...kd.map((k) => { const m = minDia(p.id, k); return m ? fmtDec(m / 60) : ""; }), fmtDec(c.horas), fmtDec(c.contrato), fmtDec(c.extra), fmtDec(c.precio), fmtDec(c.importe)]),
        [],
        ["Persona", "Fecha", "Día", "Cliente", "Tiempo (h:mm)", "Horas (decimal)"],
        ...semana.map((t) => [nombreDe(estado.perfiles.find((x) => x.id === t.usuario_id)), t.fecha, diaCorto(deYmd(t.fecha)), t.cliente, fmtMin(t.minutos), fmtDec(t.minutos / 60)]),
      ];
      descargarCSV(`horas_semana_${ymd(lunes)}_a_${ymd(dom)}.csv`, filasCSV);
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
