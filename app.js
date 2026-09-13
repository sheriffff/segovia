(() => {
  const CAMPUS = { lat: 40.95293, lon: -4.11869, nombre: "Campus IE · Santa Cruz la Real" };
  const MAX_PLAZAS = 3;
  const TIPOS = { asador: "Asador", tapas: "Tapas y raciones", moderno: "Cocina moderna" };
  const VIERNES = (() => {
    const out = [];
    const d = new Date(Date.UTC(2026, 8, 18));
    const fin = Date.UTC(2026, 11, 4);
    while (d.getTime() <= fin) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return out;
  })();
  const RESTOS = (window.RESTAURANTES || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const restoPorId = (id) => RESTOS.find((r) => r.id === id);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const hoy = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const fmtLargo = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const fmtCorto = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  const fecha = (iso) => new Date(iso + "T12:00:00Z");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Almacenamiento (API o demo local) ----------
  const tokens = (() => {
    try { return JSON.parse(localStorage.getItem("jca_tokens") || "{}"); } catch { return {}; }
  })();
  const guardarTokens = () => { try { localStorage.setItem("jca_tokens", JSON.stringify(tokens)); } catch {} };
  const params = new URLSearchParams(location.search);
  if (params.get("admin")) {
    try { localStorage.setItem("jca_admin", params.get("admin")); } catch {}
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const adminKey = (() => { try { return localStorage.getItem("jca_admin") || ""; } catch { return ""; } })();

  let demo = false;
  let reservas = {};

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  const api = {
    async cargar() {
      const r = await fetch("/api/reservas", { headers: { accept: "application/json" } });
      if (r.status === 503) throw new Error("sin-bd");
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    },
    async enviar(metodo, body) {
      const r = await fetch("/api/reservas", {
        method: metodo,
        headers: { "content-type": "application/json", ...(adminKey ? { "x-admin-key": adminKey } : {}) },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Error " + r.status);
      return data;
    },
  };

  const local = {
    leer() { try { return JSON.parse(localStorage.getItem("jca_demo") || "{}"); } catch { return {}; } },
    escribir(d) { try { localStorage.setItem("jca_demo", JSON.stringify(d)); } catch {} },
    async cargar() { return { reservas: this.leer() }; },
    async enviar(metodo, body) {
      const d = this.leer();
      if (metodo === "POST") {
        const dia = d[body.fecha] || { restauranteId: body.restauranteId, plazas: [] };
        if (dia.plazas.length >= MAX_PLAZAS) throw new Error("Ese viernes ya está completo");
        if (!dia.plazas.length) dia.restauranteId = body.restauranteId;
        const id = uuid();
        dia.plazas.push({ id, nombre: body.nombre, foto: body.foto, creado: Date.now(), token: body.token });
        d[body.fecha] = dia;
        this.escribir(d);
        return { ok: true, plazaId: id, reservas: this.leer() };
      }
      if (metodo === "DELETE") {
        const dia = d[body.fecha];
        if (dia) {
          dia.plazas = dia.plazas.filter((p) => p.id !== body.plazaId);
          if (!dia.plazas.length) delete d[body.fecha];
        }
        this.escribir(d);
        return { ok: true, reservas: this.leer() };
      }
      if (metodo === "PATCH") {
        const dia = d[body.fecha];
        if (dia) dia.restauranteId = body.restauranteId;
        this.escribir(d);
        return { ok: true, reservas: this.leer() };
      }
    },
  };
  const store = () => (demo ? local : api);

  // ---------- Avisos ----------
  const avisoEl = $("#aviso");
  let avisoTimer;
  const aviso = (txt, { fijo = false, tipo = "" } = {}) => {
    avisoEl.textContent = txt;
    avisoEl.className = "aviso visible " + tipo;
    clearTimeout(avisoTimer);
    if (!fijo) avisoTimer = setTimeout(() => avisoEl.classList.remove("visible"), 4200);
  };

  // ---------- Viernes ----------
  const gridViernes = $("#grid-viernes");
  const fotoSrc = (p) => p.foto || (p.fotoId ? `/api/reservas?foto=${encodeURIComponent(p.fotoId)}` : "");
  const esMia = (p) => !!tokens[p.id] || !!adminKey;
  const soyDelDia = (dia) => !!adminKey || (dia && dia.plazas.some((p) => tokens[p.id]));

  function renderViernes() {
    gridViernes.innerHTML = VIERNES.map((iso) => {
      const dia = reservas[iso];
      const n = dia ? dia.plazas.length : 0;
      const pasado = iso < hoy;
      const estado = pasado ? "pasado" : n === 0 ? "libre" : n >= MAX_PLAZAS ? "lleno" : "parcial";
      const etiqueta = { pasado: "Pasado", libre: "Libre", lleno: "Completo", parcial: `${MAX_PLAZAS - n} ${MAX_PLAZAS - n === 1 ? "plaza" : "plazas"}` }[estado];
      const d = fecha(iso);
      const resto = dia && restoPorId(dia.restauranteId);
      const plazas = dia ? dia.plazas : [];
      const huecos = Math.max(0, MAX_PLAZAS - plazas.length);
      const puedoCambiar = !pasado && soyDelDia(dia);
      return `
        <article class="dia dia--${estado}" data-fecha="${iso}">
          <div class="dia__cab">
            <div class="dia__fecha">
              <div class="dia__num">${d.getUTCDate()}</div>
              <div class="dia__mes">${fmtCorto.format(d).replace(/^\d+ /, "").replace(".", "")}</div>
            </div>
            <span class="dia__estado">${etiqueta}</span>
          </div>
          <div class="dia__cuerpo">
            <div class="dia__resto">
              ${resto
                ? `Comemos en <strong><a href="#resto-${resto.id}" data-ir-resto="${resto.id}">${esc(resto.nombre)}</a></strong>` +
                  (puedoCambiar ? ` · <a href="#" data-cambiar="${iso}">cambiar</a>` : "")
                : pasado ? "Ya pasó." : "Nadie se ha apuntado todavía. El primero conduce y elige mesa."}
            </div>
            <div class="plazas">
              ${plazas.map((p, i) => `
                <div class="plaza ${i === 0 ? "plaza--conductor" : ""}">
                  <img class="plaza__foto" src="${esc(fotoSrc(p))}" alt="Foto de ${esc(p.nombre)}" loading="lazy" data-zoom="${esc(p.nombre)}">
                  <div><span class="plaza__nombre">${esc(p.nombre)}</span><span class="plaza__rol">${i === 0 ? "Conduce" : "Va de paquete"}</span></div>
                  ${esMia(p) && !pasado ? `<button class="plaza__borrar" data-borrar="${p.id}" data-fecha="${iso}">borrarme</button>` : ""}
                </div>`).join("")}
              ${!pasado ? Array.from({ length: huecos }, () => `
                <div class="plaza plaza--vacia"><span class="plaza__foto"></span><span>Plaza libre</span></div>`).join("") : ""}
            </div>
            <div class="dia__acciones">
              ${pasado ? "" : estado === "lleno"
                ? `<button class="btn btn--outline btn--small" disabled>Completo</button>`
                : `<button class="btn ${estado === "libre" ? "btn--teja" : "btn--ocre"} btn--small" data-apuntar="${iso}">${estado === "libre" ? "Me apunto y conduzco" : "Me apunto"}</button>`}
            </div>
          </div>
        </article>`;
    }).join("");
  }

  gridViernes.addEventListener("click", async (e) => {
    const ap = e.target.closest("[data-apuntar]");
    if (ap) return abrirModal({ fecha: ap.dataset.apuntar });
    const bo = e.target.closest("[data-borrar]");
    if (bo) {
      if (!confirm("¿Seguro que quieres borrar esta plaza?")) return;
      try {
        const r = await store().enviar("DELETE", { fecha: bo.dataset.fecha, plazaId: bo.dataset.borrar, token: tokens[bo.dataset.borrar] });
        delete tokens[bo.dataset.borrar]; guardarTokens();
        reservas = r.reservas; renderViernes(); aviso("Plaza borrada. Segovia te echará de menos.");
      } catch (err) { aviso(err.message, { tipo: "aviso--demo" }); }
      return;
    }
    const ca = e.target.closest("[data-cambiar]");
    if (ca) {
      e.preventDefault();
      return cambiarRestaurante(ca.dataset.cambiar, ca);
    }
    const ir = e.target.closest("[data-ir-resto]");
    if (ir) { e.preventDefault(); irARestaurante(ir.dataset.irResto); return; }
    const z = e.target.closest("[data-zoom]");
    if (z) {
      $("#lightbox-fig").innerHTML = `<img src="${esc(z.getAttribute("src"))}" alt=""><figcaption>${esc(z.dataset.zoom)}</figcaption>`;
      $("#lightbox").showModal();
    }
  });
  $("#lightbox").addEventListener("click", () => $("#lightbox").close());

  function cambiarRestaurante(iso, ancla) {
    const dia = reservas[iso];
    if (!dia) return;
    const sel = document.createElement("select");
    sel.innerHTML = opcionesRestaurantes(dia.restauranteId);
    sel.style.cssText = "font:inherit;font-size:.85rem;padding:.2rem .4rem;border-radius:8px;border:1.5px solid var(--piedra-oscura);max-width:100%";
    ancla.replaceWith(sel);
    sel.focus();
    const done = async () => {
      if (sel.value && sel.value !== dia.restauranteId) {
        try {
          const p = dia.plazas.find((x) => tokens[x.id]);
          const r = await store().enviar("PATCH", { fecha: iso, restauranteId: sel.value, plazaId: p && p.id, token: p && tokens[p.id] });
          reservas = r.reservas; aviso("Restaurante cambiado para todo el coche.");
        } catch (err) { aviso(err.message, { tipo: "aviso--demo" }); }
      }
      renderViernes();
    };
    sel.addEventListener("change", done);
    sel.addEventListener("blur", () => setTimeout(renderViernes, 150));
  }

  function opcionesRestaurantes(sel) {
    return Object.entries(TIPOS).map(([t, nombre]) => `
      <optgroup label="${nombre}">
        ${RESTOS.filter((r) => r.tipo === t).map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.nombre)} · ${"€".repeat(r.precio)} · ${r.minutosCampus} min</option>`).join("")}
      </optgroup>`).join("");
  }

  // ---------- Modal de reserva ----------
  const modal = $("#modal-reserva");
  const form = $("#form-reserva");
  const fFecha = $("#f-fecha"), fNombre = $("#f-nombre"), fResto = $("#f-resto"), fFoto = $("#f-foto");
  const fotoPrev = $("#foto-prev"), formError = $("#form-error");
  let fotoData = "";

  function abrirModal({ fecha: iso, restauranteId } = {}) {
    const libres = VIERNES.filter((f) => f >= hoy && (!reservas[f] || reservas[f].plazas.length < MAX_PLAZAS));
    if (!libres.length) return aviso("No quedan viernes libres. ¡Vaya éxito!");
    fFecha.innerHTML = libres.map((f) => {
      const n = reservas[f] ? reservas[f].plazas.length : 0;
      const txt = n === 0 ? "libre, tú conduces" : `${MAX_PLAZAS - n} ${MAX_PLAZAS - n === 1 ? "plaza" : "plazas"}, conduce ${reservas[f].plazas[0].nombre}`;
      return `<option value="${f}">${cap(fmtLargo.format(fecha(f)))} · ${esc(txt)}</option>`;
    }).join("");
    fFecha.value = iso && libres.includes(iso) ? iso : libres[0];
    fResto.innerHTML = opcionesRestaurantes(restauranteId || "");
    actualizarModalFecha(restauranteId);
    form.hidden = false; $("#modal-ok").hidden = true; formError.hidden = true;
    try { fNombre.value = localStorage.getItem("jca_nombre") || fNombre.value; } catch {}
    modal.showModal();
  }
  function actualizarModalFecha(forzarResto) {
    const dia = reservas[fFecha.value];
    const conductor = dia && dia.plazas.length ? dia.plazas[0] : null;
    if (conductor) {
      $("#f-fecha-ayuda").textContent = `Vas de paquete con ${conductor.nombre}${dia.plazas.length > 1 ? " y compañía" : ""}. Quedaos en contacto para el punto de recogida.`;
      fResto.value = forzarResto || dia.restauranteId;
      const r = restoPorId(dia.restauranteId);
      $("#f-resto-ayuda").textContent = r ? `${conductor.nombre} ya eligió ${r.nombre}. Si lo cambias, cambia para todo el coche: consúltalo antes.` : "";
    } else {
      $("#f-fecha-ayuda").textContent = "Ese viernes está libre: tú conduces, tú eliges restaurante y tú mandas.";
      if (forzarResto) fResto.value = forzarResto;
      $("#f-resto-ayuda").textContent = "Elige con cabeza: mira los minutos andando al campus.";
    }
  }
  fFecha.addEventListener("change", () => actualizarModalFecha());
  $$("[data-cerrar]").forEach((b) => b.addEventListener("click", () => modal.close()));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  fFoto.addEventListener("change", async () => {
    const file = fFoto.files[0];
    if (!file) return;
    try {
      fotoData = await reducirFoto(file, 360);
      fotoPrev.innerHTML = `<img src="${fotoData}" alt="Tu foto">`;
      fotoPrev.classList.add("ok");
    } catch (err) {
      fotoData = ""; fotoPrev.textContent = "📷"; fotoPrev.classList.remove("ok");
      mostrarError("No he podido leer esa imagen. Prueba con otra.");
    }
  });

  function reducirFoto(file, tam) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = tam; c.height = tam;
        const ctx = c.getContext("2d");
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, tam, tam);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
      img.src = url;
    });
  }

  const mostrarError = (t) => { formError.textContent = t; formError.hidden = false; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;
    const nombre = fNombre.value.trim();
    if (nombre.length < 2) return mostrarError("Pon tu nombre, que luego nadie sabe quién es quién.");
    if (!fotoData) return mostrarError("Sube una foto: es la regla de la casa.");
    if (!fResto.value) return mostrarError("Elige dónde comemos.");
    const btn = $("#form-enviar");
    btn.disabled = true; btn.textContent = "Reservando…";
    const token = uuid();
    try {
      const r = await store().enviar("POST", { fecha: fFecha.value, nombre, restauranteId: fResto.value, foto: fotoData, token });
      tokens[r.plazaId] = token; guardarTokens();
      try { localStorage.setItem("jca_nombre", nombre); } catch {}
      reservas = r.reservas;
      renderViernes();
      const dia = reservas[fFecha.value];
      const resto = restoPorId(dia.restauranteId);
      const conduces = dia.plazas[0].id === r.plazaId;
      $("#modal-ok-texto").textContent = `${cap(fmtLargo.format(fecha(fFecha.value)))}, comemos en ${resto ? resto.nombre : "donde sea"}. ${conduces ? "Tú conduces: avisa al Sheriff del punto de recogida." : `Conduce ${dia.plazas[0].nombre}: poneos de acuerdo para la recogida.`}`;
      form.hidden = true; $("#modal-ok").hidden = false;
      fotoData = ""; fotoPrev.textContent = "📷"; fotoPrev.classList.remove("ok"); fFoto.value = "";
    } catch (err) {
      mostrarError(err.message || "No se ha podido reservar. Inténtalo otra vez.");
      if (/completo|lleno/i.test(err.message || "")) { try { const d = await store().cargar(); reservas = d.reservas || {}; renderViernes(); } catch {} }
    } finally {
      btn.disabled = false; btn.textContent = "Reservar plaza";
    }
  });

  // ---------- Restaurantes: filtros, lista y mapa ----------
  const filtros = { tipo: "", precio: "" };
  const gridRestos = $("#grid-restos");
  const mapa = L.map("mapa", { scrollWheelZoom: false }).setView([40.9495, -4.1215], 15);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(mapa);
  L.marker([CAMPUS.lat, CAMPUS.lon], {
    icon: L.divIcon({ className: "", html: `<div class="marker-campus">CAMPUS IE</div>`, iconSize: [90, 26], iconAnchor: [45, 13] }),
    zIndexOffset: 500,
  }).addTo(mapa).bindPopup(`<h4>${CAMPUS.nombre}</h4><div class="pop-meta">Aquí da clase el Sheriff de 16:20 a 20:00.</div>`);

  const markers = {};
  RESTOS.forEach((r) => {
    const m = L.marker([r.lat, r.lon], {
      icon: L.divIcon({ className: "", html: `<div class="marker-pin marker-pin--${r.tipo}" data-marker="${r.id}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      title: r.nombre,
    });
    m.bindPopup(`<h4>${esc(r.nombre)}</h4><div class="pop-meta">${TIPOS[r.tipo]} · ${"€".repeat(r.precio)} · 🚶 ${r.minutosCampus} min al campus</div><button class="btn btn--teja btn--small" data-comer="${r.id}">Comer aquí</button>`);
    m.on("click", () => marcarActivo(r.id, true));
    markers[r.id] = m;
  });
  mapa.on("popupclose", () => marcarActivo(null));
  $("#mapa").addEventListener("click", (e) => {
    const b = e.target.closest("[data-comer]");
    if (b) { mapa.closePopup(); abrirModal({ restauranteId: b.dataset.comer }); }
  });

  const pasaFiltro = (r) => (!filtros.tipo || r.tipo === filtros.tipo) && (!filtros.precio || String(r.precio) === filtros.precio);

  function renderRestos() {
    const visibles = RESTOS.filter(pasaFiltro);
    gridRestos.innerHTML = visibles.map((r) => `
      <article class="resto resto--${r.tipo}" id="resto-${r.id}" data-resto="${r.id}">
        <div class="resto__cab">
          <h3 class="resto__nombre">${esc(r.nombre)}</h3>
          <span class="resto__precio" title="${["", "Hasta 20 € por persona", "Entre 20 y 40 € por persona", "Más de 40 € por persona"][r.precio]}">${"€".repeat(r.precio)}<span class="off">${"€".repeat(3 - r.precio)}</span></span>
        </div>
        <div class="resto__meta">
          <span class="tag tag--tipo">${TIPOS[r.tipo]}</span>
          <span class="tag tag--campus">🚶 ${r.minutosCampus} min al campus</span>
          ${r.cochinillo ? `<span class="tag">🐷 Cochinillo</span>` : ""}
          ${r.cordero ? `<span class="tag">🐑 Cordero</span>` : ""}
          ${r.terraza ? `<span class="tag">☀️ Terraza</span>` : ""}
          ${r.vegetariano ? `<span class="tag">🌱 Opción veggie</span>` : ""}
        </div>
        <p class="resto__frase">${esc(r.frase)}</p>
        <p class="resto__platos"><strong>Para pedir</strong>${r.platos.map(esc).join(" · ")}</p>
        <p class="resto__dir"><a href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank" rel="noopener">📍 ${esc(r.direccion)}</a>${r.horario ? ` · ${esc(r.horario)}` : ""}</p>
        <div class="resto__pie">
          ${r.web ? `<a href="${esc(r.web)}" target="_blank" rel="noopener">Web</a>` : ""}
          ${r.telefono ? `<a href="tel:${esc(r.telefono.replace(/\s/g, ""))}">${esc(r.telefono)}</a>` : ""}
          <button class="btn btn--teja btn--small" data-comer="${r.id}">Comer aquí</button>
        </div>
      </article>`).join("");
    $("#filtros-resultado").textContent = visibles.length === RESTOS.length
      ? `${RESTOS.length} sitios donde comer bien.`
      : visibles.length ? `${visibles.length} de ${RESTOS.length} sitios.` : "Nada con esos filtros. Afloja un poco, que en Segovia se come bien en todas partes.";
    RESTOS.forEach((r) => {
      const on = pasaFiltro(r);
      if (on && !mapa.hasLayer(markers[r.id])) markers[r.id].addTo(mapa);
      if (!on && mapa.hasLayer(markers[r.id])) mapa.removeLayer(markers[r.id]);
    });
    if (visibles.length) mapa.fitBounds(L.latLngBounds([[CAMPUS.lat, CAMPUS.lon], ...visibles.map((r) => [r.lat, r.lon])]).pad(0.12), { animate: true });
  }

  function marcarActivo(id, desdeMapa) {
    $$(".marker-pin--activo").forEach((el) => el.classList.remove("marker-pin--activo"));
    $$(".resto--activo").forEach((el) => el.classList.remove("resto--activo"));
    if (!id) return;
    const pin = $(`[data-marker="${id}"]`); if (pin) pin.classList.add("marker-pin--activo");
    const card = $(`#resto-${id}`);
    if (card) { card.classList.add("resto--activo"); if (desdeMapa) card.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  function irARestaurante(id) {
    const r = restoPorId(id); if (!r) return;
    if (!pasaFiltro(r)) { filtros.tipo = ""; filtros.precio = ""; $$(".chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.valor === "" ? "true" : "false")); renderRestos(); }
    const card = $(`#resto-${id}`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    marcarActivo(id);
    markers[id].openPopup();
  }

  gridRestos.addEventListener("mouseover", (e) => { const c = e.target.closest("[data-resto]"); if (c) marcarActivo(c.dataset.resto); });
  gridRestos.addEventListener("mouseleave", () => marcarActivo(null));
  gridRestos.addEventListener("click", (e) => {
    const b = e.target.closest("[data-comer]");
    if (b) return abrirModal({ restauranteId: b.dataset.comer });
    const c = e.target.closest("[data-resto]");
    if (c && !e.target.closest("a")) { markers[c.dataset.resto].openPopup(); $("#mapa").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  });

  $("#filtros").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    filtros[chip.dataset.filtro] = chip.dataset.valor;
    $$(`.chip[data-filtro="${chip.dataset.filtro}"]`).forEach((c) => c.setAttribute("aria-pressed", c === chip ? "true" : "false"));
    renderRestos();
  });

  // ---------- Arranque ----------
  async function cargar() {
    try {
      const d = await api.cargar();
      reservas = d.reservas || {};
    } catch (err) {
      demo = true;
      reservas = local.leer();
      aviso(err.message === "sin-bd"
        ? "La base de datos aún no está conectada: las reservas se guardan solo en este navegador."
        : "Modo demo: sin servidor, las reservas se guardan solo en este navegador.", { fijo: true, tipo: "aviso--demo" });
    }
    renderViernes();
  }
  renderRestos();
  cargar();
  if (location.hash === "#reservar") abrirModal();
})();
