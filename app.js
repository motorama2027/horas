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
    calMes: inicioMes(new Date()),
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

  // ================================================================ CALENDARIO (L–D)
  async function vistaCalendario() {
    const yo = estado.yo;
    const activos = estado.perfiles.filter((p) => p.activo);
    const selector = yo.es_admin
      ? `<select id="cal-usuario" aria-label="Persona">${activos.map((p) => `<option value="${p.id}" ${p.id === estado.calUsuario ? "selected" : ""}>${esc(nombreDe(p))}${p.id === yo.id ? " (yo)" : ""}</option>`).join("")}</select>`
      : "";
    $("#contenido").innerHTML = `
      <div class="barra">
        <button class="btn btn-sm" id="cal-prev" aria-label="Mes anterior">‹</button>
        <div class="titulo-periodo" id="cal-titulo"></div>
        <button class="btn btn-sm" id="cal-next" aria-label="Mes siguiente">›</button>
        <button class="btn btn-sm btn-fantasma" id="cal-hoy">Hoy</button>
        <span class="espacio"></span>
        ${selector}
      </div>
      <div class="resumen" id="cal-resumen"></div>
      <div class="cal-envoltura"><div class="cal" id="cal"></div></div>
      <div class="leyenda">${Object.entries(TIPOS).map(([k, t]) => `<span class="chip chip-${k}">${t}</span>`).join("")}
        <span>· Pulsa un día para apuntar o corregir las horas.</span></div>`;

    $("#cal-prev").onclick = () => { estado.calMes = new Date(estado.calMes.getFullYear(), estado.calMes.getMonth() - 1, 1); pintarCalendario(); };
    $("#cal-next").onclick = () => { estado.calMes = new Date(estado.calMes.getFullYear(), estado.calMes.getMonth() + 1, 1); pintarCalendario(); };
    $("#cal-hoy").onclick = () => { estado.calMes = inicioMes(new Date()); pintarCalendario(); };
    if (yo.es_admin) $("#cal-usuario").onchange = (e) => { estado.calUsuario = e.target.value; pintarCalendario(); };
    pintarCalendario();
  }

  function perfilCal() {
    return estado.calUsuario === estado.yo.id ? estado.yo : estado.perfiles.find((p) => p.id === estado.calUsuario) || estado.yo;
  }

  async function pintarCalendario() {
    const mes = estado.calMes;
    $("#cal-titulo").textContent = `${MESES[mes.getMonth()]} ${mes.getFullYear()}`;
    const ini = lunesDe(mes);
    const finMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const fin = sumarDias(lunesDe(finMes), 6);

    const { data, error } = await sb.from("registros").select("*")
      .eq("usuario_id", estado.calUsuario).gte("fecha", ymd(ini)).lte("fecha", ymd(fin));
    if (error) return aviso(errorTxt(error), true);
    estado.registrosMes = new Map(data.map((r) => [r.fecha, r]));

    const p = perfilCal();
    const objetivo = Number(p.horas_semanales) || 0;
    const hoy = ymd(new Date());
    let html = DIAS_CORTOS.map((d, i) => `<div class="cal-cab">${d}</div>`).join("") + `<div class="cal-cab sem">Semana</div>`;
    let totalMes = 0, diasTrab = 0, diasVac = 0;

    for (let l = new Date(ini); l <= fin; l = sumarDias(l, 7)) {
      let totalSem = 0;
      for (let i = 0; i < 7; i++) {
        const d = sumarDias(l, i), k = ymd(d), r = estado.registrosMes.get(k);
        const dentro = d.getMonth() === mes.getMonth();
        const h = r ? Number(r.horas) : 0;
        totalSem += h;
        if (dentro && r) {
          totalMes += h;
          if (r.tipo === "trabajo" && h > 0) diasTrab++;
          if (r.tipo === "vacaciones") diasVac++;
        }
        const clases = ["dia", esFinde(d) && "finde", !dentro && "fuera", k === hoy && "hoy"].filter(Boolean).join(" ");
        html += `<button type="button" class="${clases}" data-fecha="${k}" aria-label="${fechaLarga(d)}">
          <span class="dia-num">${d.getDate()}</span>
          ${r ? `<span class="chip chip-${r.tipo}">${TIPOS[r.tipo]}</span>` : ""}
          ${r && r.tipo === "trabajo" ? `<span class="dia-horas">${fmtH(h)}</span><span class="dia-tramos">${esc(tramosTxt(r))}</span>` : ""}
        </button>`;
      }
      const dif = totalSem - objetivo;
      html += `<div class="sem-total"><span class="sub">S${numSemana(l)}</span><span class="val">${fmtH(totalSem)}</span>
        <span class="sub ${dif >= 0 ? "dif-pos" : "dif-neg"}">${objetivo ? (dif >= 0 ? "+" : "") + fmtH(dif) : ""}</span></div>`;
    }
    $("#cal").innerHTML = html;
    $("#cal").querySelectorAll(".dia").forEach((b) => (b.onclick = () => editarDia(b.dataset.fecha)));

    // resumen de la semana actual + mes
    const lunesHoy = lunesDe(new Date());
    let semActual = 0;
    for (let i = 0; i < 7; i++) { const r = estado.registrosMes.get(ymd(sumarDias(lunesHoy, i))); if (r) semActual += Number(r.horas); }
    const enRango = lunesHoy >= ini && lunesHoy <= fin;
    $("#cal-resumen").innerHTML = `
      ${enRango ? `<div class="dato"><div class="etq">Esta semana</div><div class="val">${fmtH(semActual)}</div><div class="sub">de ${fmtH(objetivo)} previstas</div></div>` : ""}
      <div class="dato"><div class="etq">Total ${MESES[mes.getMonth()]}</div><div class="val">${fmtH(totalMes)}</div><div class="sub">${fmtDec(totalMes)} h decimales</div></div>
      <div class="dato"><div class="etq">Días trabajados</div><div class="val">${diasTrab}</div><div class="sub">en el mes</div></div>
      <div class="dato"><div class="etq">Vacaciones</div><div class="val">${diasVac}</div><div class="sub">días en el mes</div></div>`;
  }

  function editarDia(fecha) {
    const r = estado.registrosMes.get(fecha) || { tipo: "trabajo", entrada1: "", salida1: "", entrada2: "", salida2: "", pausa_min: 0, nota: "" };
    const p = perfilCal();
    const ajeno = p.id !== estado.yo.id;
    abrirModal(fechaLarga(deYmd(fecha)), `
      <form id="form-dia">
        ${ajeno ? `<p class="muted" style="margin:0">Editando las horas de <b>${esc(nombreDe(p))}</b></p>` : ""}
        <label for="d-tipo">Tipo de día</label>
        <select id="d-tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${r.tipo === k ? "selected" : ""}>${t}</option>`).join("")}</select>
        <div id="d-horario" class="tramos">
          <div class="tramo-tit">Turno 1 (mañana o jornada continua)</div>
          <div><label for="d-e1">Entrada</label><input id="d-e1" type="time" value="${hm(r.entrada1)}"></div>
          <div><label for="d-s1">Salida</label><input id="d-s1" type="time" value="${hm(r.salida1)}"></div>
          <div class="tramo-tit">Turno 2 (tarde, opcional si haces jornada partida)</div>
          <div><label for="d-e2">Entrada</label><input id="d-e2" type="time" value="${hm(r.entrada2)}"></div>
          <div><label for="d-s2">Salida</label><input id="d-s2" type="time" value="${hm(r.salida2)}"></div>
          <div><label for="d-pausa">Descanso (minutos)</label><input id="d-pausa" type="number" min="0" max="600" step="5" value="${Number(r.pausa_min) || 0}"></div>
        </div>
        <label for="d-nota">Nota (opcional)</label>
        <input id="d-nota" maxlength="200" value="${esc(r.nota)}" placeholder="Ej.: inventario, salí antes por médico…">
        <div class="total-dia"><span>Total del día</span><span class="val" id="d-total">0:00</span></div>
        <p class="error" id="d-error"></p>
        <div class="acciones">
          ${r.id ? `<button type="button" class="btn btn-peligro izq" id="d-borrar">Borrar día</button>` : ""}
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>`);

    const leer = () => ({
      tipo: $("#d-tipo").value,
      entrada1: $("#d-e1").value || null, salida1: $("#d-s1").value || null,
      entrada2: $("#d-e2").value || null, salida2: $("#d-s2").value || null,
      pausa_min: parseInt($("#d-pausa").value, 10) || 0,
      nota: $("#d-nota").value.trim(),
    });
    const refrescar = () => {
      const v = leer();
      $("#d-horario").hidden = v.tipo !== "trabajo";
      $("#d-total").textContent = fmtH(calcularHoras(v));
    };
    $("#form-dia").addEventListener("input", refrescar);
    refrescar();

    if (r.id) $("#d-borrar").onclick = async () => {
      const { error } = await sb.from("registros").delete().eq("id", r.id);
      if (error) return ($("#d-error").textContent = errorTxt(error));
      cerrarModal(); aviso("Día borrado"); pintarCalendario();
    };

    $("#form-dia").onsubmit = async (e) => {
      e.preventDefault();
      const v = leer();
      if (v.tipo === "trabajo") {
        if (!(v.entrada1 && v.salida1)) return ($("#d-error").textContent = "Pon al menos la hora de entrada y de salida del turno 1.");
        if (!!v.entrada2 !== !!v.salida2) return ($("#d-error").textContent = "En el turno 2 faltan la entrada o la salida.");
      } else {
        Object.assign(v, { entrada1: null, salida1: null, entrada2: null, salida2: null, pausa_min: 0 });
      }
      v.horas = calcularHoras(v);
      if (v.horas > 16) return ($("#d-error").textContent = "Más de 16 horas en un día: revisa las horas.");
      const fila = { ...v, usuario_id: p.id, fecha };
      const { error } = await sb.from("registros").upsert(fila, { onConflict: "usuario_id,fecha" });
      if (error) return ($("#d-error").textContent = errorTxt(error));
      cerrarModal(); aviso("Guardado"); pintarCalendario();
    };
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
        <div><label for="f-horas">Horas semanales de contrato</label><input id="f-horas" type="number" min="0" max="80" step="0.5" value="${Number(p.horas_semanales)}" ${ro}></div>
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
        <td>${esc(p.telefono) || '<span class="muted">—</span>'}</td>
        <td>${p.es_admin ? '<span class="chip chip-admin">Master</span> ' : ""}<span class="chip ${p.activo ? "chip-activo" : "chip-inactivo"}">${p.activo ? "Activo" : "Inactivo"}</span></td>
      </tr>`).join("");
    $("#contenido").innerHTML = `
      <div class="barra"><h1>Usuarios</h1><span class="espacio"></span>
        <button class="btn btn-primario" id="btn-nuevo">+ Nuevo usuario</button></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Puesto</th><th class="num">H/semana</th><th>Teléfono</th><th>Estado</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="6" class="vacio">Todavía no hay usuarios.</td></tr>`}</tbody>
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
          <div><label for="n-horas">Horas semanales de contrato</label><input id="n-horas" type="number" min="0" max="80" step="0.5" value="40"></div>
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
        <button class="btn btn-sm" id="inf-csv">Descargar Excel (CSV)</button>
        <button class="btn btn-sm" id="inf-print">Imprimir / PDF</button>
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
    $("#inf-print").onclick = () => window.print();
    pintarInforme();
  }

  async function pintarInforme() {
    const lunes = estado.infLunes, dom = sumarDias(lunes, 6);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    $("#inf-titulo").textContent = `Informe semana ${numSemana(lunes)}`;
    $("#inf-sub").textContent = rangoSemana(lunes);

    const desdeHist = sumarDias(lunes, -7 * 7);
    const { data, error } = await sb.from("registros").select("*").gte("fecha", ymd(desdeHist)).lte("fecha", ymd(dom));
    if (error) return aviso(errorTxt(error), true);

    const semana = data.filter((r) => r.fecha >= ymd(lunes));
    const conHoras = new Set(semana.map((r) => r.usuario_id));
    const personas = estado.perfiles.filter((p) => p.activo || conHoras.has(p.id));
    const mapa = new Map(semana.map((r) => [`${r.usuario_id}|${r.fecha}`, r]));

    const totDia = Array(7).fill(0);
    let totGen = 0, totObj = 0;
    const filas = personas.map((p) => {
      let t = 0;
      const celdas = dias.map((d, i) => {
        const r = mapa.get(`${p.id}|${ymd(d)}`);
        const h = r ? Number(r.horas) : 0;
        t += h; totDia[i] += h;
        const cont = !r ? `<span class="cero">·</span>` : r.tipo !== "trabajo" ? `<span class="chip chip-${r.tipo}">${TIPOS[r.tipo]}</span>` : fmtH(h);
        return `<td class="num ${esFinde(d) ? "finde" : ""}">${cont}</td>`;
      }).join("");
      const obj = Number(p.horas_semanales) || 0, dif = t - obj;
      totGen += t; totObj += obj;
      return { p, t, html: `<tr><td><b>${esc(nombreDe(p))}</b><div class="muted" style="font-size:.78rem">${esc(p.puesto)}</div></td>${celdas}
        <td class="num"><b>${fmtH(t)}</b></td><td class="num muted">${fmtH(obj)}</td>
        <td class="num ${dif >= 0 ? "dif-pos" : "dif-neg"}">${dif >= 0 ? "+" : ""}${fmtH(dif)}</td></tr>` };
    });

    $("#inf-tabla").innerHTML = `<table>
      <thead><tr><th>Persona</th>${dias.map((d) => `<th class="num ${esFinde(d) ? "finde" : ""}">${diaCorto(d)}</th>`).join("")}
        <th class="num">Total</th><th class="num">Contrato</th><th class="num">Diferencia</th></tr></thead>
      <tbody>${filas.map((f) => f.html).join("") || `<tr><td colspan="11" class="vacio">No hay usuarios activos.</td></tr>`}</tbody>
      <tfoot><tr><td>Total equipo</td>${totDia.map((h, i) => `<td class="num ${esFinde(dias[i]) ? "finde" : ""}">${fmtH(h)}</td>`).join("")}
        <td class="num">${fmtH(totGen)}</td><td class="num">${fmtH(totObj)}</td>
        <td class="num ${totGen - totObj >= 0 ? "dif-pos" : "dif-neg"}">${totGen - totObj >= 0 ? "+" : ""}${fmtH(totGen - totObj)}</td></tr></tfoot>
    </table>`;

    const sinApuntar = personas.filter((p) => p.activo && !dias.slice(0, 5).some((d) => mapa.has(`${p.id}|${ymd(d)}`)));
    $("#inf-resumen").innerHTML = `
      <div class="dato"><div class="etq">Horas del equipo</div><div class="val">${fmtH(totGen)}</div><div class="sub">${fmtDec(totGen)} h decimales</div></div>
      <div class="dato"><div class="etq">Previstas por contrato</div><div class="val">${fmtH(totObj)}</div><div class="sub">${personas.length} personas</div></div>
      <div class="dato"><div class="etq">Diferencia</div><div class="val ${totGen - totObj >= 0 ? "dif-pos" : "dif-neg"}">${totGen - totObj >= 0 ? "+" : ""}${fmtH(totGen - totObj)}</div><div class="sub">horas extra o pendientes</div></div>
      <div class="dato"><div class="etq">Sin apuntar L–V</div><div class="val">${sinApuntar.length}</div><div class="sub">${sinApuntar.map((p) => esc(p.nombre || p.usuario)).join(", ") || "todos al día"}</div></div>`;

    // Detalle por persona: entradas y salidas de cada día
    $("#inf-detalle").innerHTML = filas.filter((f) => dias.some((d) => mapa.has(`${f.p.id}|${ymd(d)}`))).map(({ p, t }) => `
      <div class="detalle-persona">
        <h3>${esc(nombreDe(p))} <span class="muted num" style="font-weight:500">${fmtH(t)} esta semana</span></h3>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Día</th><th>Tipo</th><th>Turno 1</th><th>Turno 2</th><th class="num">Descanso</th><th class="num">Horas</th><th>Nota</th></tr></thead>
          <tbody>${dias.map((d) => {
            const r = mapa.get(`${p.id}|${ymd(d)}`);
            if (!r) return `<tr><td class="${esFinde(d) ? "finde" : ""}">${diaCorto(d)}</td><td colspan="6" class="cero">sin registro</td></tr>`;
            const t1 = r.entrada1 ? `${hm(r.entrada1)}–${hm(r.salida1)}` : "—";
            const t2 = r.entrada2 ? `${hm(r.entrada2)}–${hm(r.salida2)}` : "—";
            return `<tr><td class="${esFinde(d) ? "finde" : ""}">${diaCorto(d)}</td><td><span class="chip chip-${r.tipo}">${TIPOS[r.tipo]}</span></td>
              <td class="num" style="text-align:left">${t1}</td><td class="num" style="text-align:left">${t2}</td>
              <td class="num">${r.pausa_min ? r.pausa_min + " min" : "—"}</td><td class="num"><b>${fmtH(r.horas)}</b></td><td>${esc(r.nota)}</td></tr>`;
          }).join("")}</tbody></table></div>
      </div>`).join("");

    // Histórico de las últimas 8 semanas
    const lunesHist = Array.from({ length: 8 }, (_, i) => sumarDias(lunes, -7 * (7 - i)));
    const totHist = (pid, l) => data.filter((r) => r.usuario_id === pid && r.fecha >= ymd(l) && r.fecha <= ymd(sumarDias(l, 6))).reduce((a, r) => a + Number(r.horas), 0);
    $("#inf-historico").innerHTML = `<h2>Últimas 8 semanas</h2><div class="tabla-envoltura"><table>
      <thead><tr><th>Persona</th>${lunesHist.map((l) => `<th class="num">S${numSemana(l)}<div style="font-weight:500;text-transform:none">${l.getDate()} ${MESES[l.getMonth()].slice(0, 3)}</div></th>`).join("")}</tr></thead>
      <tbody>${personas.map((p) => `<tr><td>${esc(nombreDe(p))}</td>${lunesHist.map((l) => { const h = totHist(p.id, l); return `<td class="num">${h ? fmtH(h) : '<span class="cero">·</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>`;

    // Exportar CSV (se abre en Excel)
    $("#inf-csv").onclick = () => {
      const sep = ";";
      const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const lineas = [
        [q(`Informe semana ${numSemana(lunes)}`), q(rangoSemana(lunes))].join(sep),
        "",
        ["Persona", "Puesto", ...dias.map((d) => diaCorto(d)), "Total", "Contrato", "Diferencia"].map(q).join(sep),
        ...personas.map((p) => {
          let t = 0;
          const v = dias.map((d) => {
            const r = mapa.get(`${p.id}|${ymd(d)}`);
            if (!r) return "";
            t += Number(r.horas);
            return r.tipo === "trabajo" ? fmtDec(r.horas) : TIPOS[r.tipo];
          });
          const obj = Number(p.horas_semanales) || 0;
          return [q(nombreDe(p)), q(p.puesto), ...v.map(q), q(fmtDec(t)), q(fmtDec(obj)), q(fmtDec(t - obj))].join(sep);
        }),
        "",
        ["Persona", "Fecha", "Tipo", "Entrada 1", "Salida 1", "Entrada 2", "Salida 2", "Descanso (min)", "Horas", "Nota"].map(q).join(sep),
        ...semana.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((r) => {
          const p = estado.perfiles.find((x) => x.id === r.usuario_id);
          return [nombreDe(p), r.fecha, TIPOS[r.tipo], hm(r.entrada1), hm(r.salida1), hm(r.entrada2), hm(r.salida2), r.pausa_min, fmtDec(r.horas), r.nota].map(q).join(sep);
        }),
      ];
      const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `horas_semana_${ymd(lunes)}_a_${ymd(dom)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  // ================================================================ INICIO
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && estado.yo) { estado.yo = null; mostrarLogin(); } });
  arrancar();
})();
