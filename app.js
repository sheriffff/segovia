(() => {
  const CAMPUS = { lat: 40.95293, lon: -4.11869, nombre: "Campus IE · Santa Cruz la Real" };
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const HITOS = [
    { nombre: "Acueducto", icono: "🏛️", lat: 40.94812, lon: -4.11787 },
    { nombre: "Alcázar", icono: "🏰", lat: 40.95270, lon: -4.13270 },
  ];
  const MAX_PLAZAS = 3;
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
  // Orden al azar en cada carga para que no salga siempre el mismo primero.
  const RESTOS = (() => {
    const lista = (window.RESTAURANTES || []).slice();
    for (let i = lista.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
  })();
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
  let albums = {};
  const albumTokens = (() => {
    try { return JSON.parse(localStorage.getItem("jca_album_tokens") || "{}"); } catch { return {}; }
  })();
  const guardarAlbumTokens = () => { try { localStorage.setItem("jca_album_tokens", JSON.stringify(albumTokens)); } catch {} };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  const api = {
    async cargar() {
      const r = await fetch("/api/reservas", { headers: { accept: "application/json", ...(adminKey ? { "x-admin-key": adminKey } : {}) } });
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
    leerAlbums() { try { return JSON.parse(localStorage.getItem("jca_demo_albums") || "{}"); } catch { return {}; } },
    escribirAlbums(a) { localStorage.setItem("jca_demo_albums", JSON.stringify(a)); },
    async cargar() { return { reservas: this.leer(), albums: this.leerAlbums() }; },
    async enviar(metodo, body) {
      if (body.accion === "album") {
        const a = this.leerAlbums();
        const fotos = a[body.fecha] || [];
        if (metodo === "POST") {
          const id = uuid();
          fotos.push({ id, autor: body.autor, token: body.token, creado: Date.now(), foto: body.foto, thumb: body.thumb });
          a[body.fecha] = fotos;
          try { this.escribirAlbums(a); } catch { throw new Error("El navegador no tiene sitio para más fotos en modo demo"); }
          return { ok: true, fotoId: id, albums: a };
        }
        if (metodo === "DELETE") {
          a[body.fecha] = fotos.filter((f) => f.id !== body.fotoId);
          if (!a[body.fecha].length) delete a[body.fecha];
          this.escribirAlbums(a);
          return { ok: true, albums: a };
        }
      }
      const d = this.leer();
      if (metodo === "POST") {
        const dia = d[body.fecha] || { restauranteId: body.restauranteId, plazas: [] };
        if (dia.plazas.length >= MAX_PLAZAS) throw new Error("Ese viernes ya está completo");
        if (!dia.plazas.length) dia.restauranteId = body.restauranteId;
        const id = uuid();
        dia.plazas.push({ id, nombre: body.nombre, telefono: body.telefono, foto: body.foto, creado: Date.now(), token: body.token });
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
  const thumbSrc = (f) => f.thumb || `/api/reservas?albumthumb=${encodeURIComponent(f.id)}`;
  const grandeSrc = (f) => f.foto || `/api/reservas?album=${encodeURIComponent(f.id)}`;
  const esMia = (p) => !!tokens[p.id] || !!adminKey;
  const conduzco = (dia) => !!dia && dia.plazas.length > 0 && (!!adminKey || !!tokens[dia.plazas[0].id]);

  const ETIQUETA_PRECIO = { 3: "Caros", 2: "Medio caros", 1: "Baratos" };
  const cabeceraPrecio = (precio, tag) => `<${tag} class="grupo-precio">${"€".repeat(precio)}<span class="grupo-precio__txt">${ETIQUETA_PRECIO[precio]}</span></${tag}>`;
  const precioHtml = (r) => `${"€".repeat(r.precio)}<span class="off">${"€".repeat(3 - r.precio)}</span>`;
  const tagsResto = (r) =>
    (r.cochinillo ? `<span class="tag tag--cochinillo">🐷 Cochinillo</span>` : "") +
    (r.cordero ? `<span class="tag tag--cordero">🐑 Cordero</span>` : "");
  const cuerpoResto = (r) => `
        <p class="resto__frase">${esc(r.frase)}</p>
        <p class="resto__platos"><strong>Para pedir</strong>${r.platos.map(esc).join(" · ")}</p>
        <p class="resto__dir"><a href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank" rel="noopener">📍 ${esc(r.direccion)}</a>${r.horario ? ` · ${esc(r.horario)}` : ""}</p>`;
  const enlacesResto = (r, conWeb = true) =>
    (conWeb && r.web ? `<a href="${esc(r.web)}" target="_blank" rel="noopener">Web</a>` : "") +
    (r.telefono ? `<a href="tel:${esc(r.telefono.replace(/\s/g, ""))}">${esc(r.telefono)}</a>` : "");
  const fichaResto = (r, { elegible = false, actual = false } = {}) => `
    <details class="ficha${actual ? " ficha--actual" : ""}"${elegible ? ` name="pick"` : ""}>
      <summary>
        ${r.foto ? `<img class="ficha__mini" src="${esc(r.foto)}" alt="" loading="lazy">` : ""}
        <span class="ficha__titulo"><span class="ficha__nombre">${esc(r.nombre)}</span>${r.web ? `<a class="ficha__web" href="${esc(r.web)}" target="_blank" rel="noopener">Ver página web</a>` : ""}</span>
        <span class="resto__precio">${precioHtml(r)}</span>
        <span class="ficha__sub">${tagsResto(r)}<span class="ficha__mas"></span></span>
      </summary>
      <div class="ficha__cuerpo">
        ${r.foto ? `<img class="ficha__foto" src="${esc(r.foto)}" alt="${esc(r.nombre)}" loading="lazy">` : ""}
        ${cuerpoResto(r)}
        <div class="ficha__pie">${enlacesResto(r, false)}${elegible ? `<button type="button" class="btn btn--teja btn--small" data-elegir="${r.id}">${actual ? "Me quedo con este" : "Elegir este"}</button>` : ""}</div>
      </div>
    </details>`;

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
      const puedoCambiar = !pasado && conduzco(dia);
      const conAlbum = iso <= hoy || !!adminKey;
      const fotos = albums[iso] || [];
      const bloqueAlbum = !conAlbum ? "" : `
            <div class="album">
              <div class="album__cab">
                <span class="album__titulo">La comilona en fotos</span>
                <button class="btn btn--outline btn--small" data-album-subir="${iso}">Subir fotos</button>
              </div>
              ${fotos.length ? `<div class="album__grid">${fotos.map((f) => `
                <div class="album__item">
                  <button class="album__foto" type="button" data-album-ver="${f.id}" data-fecha="${iso}" title="Foto de ${esc(f.autor)}">
                    <img src="${esc(thumbSrc(f))}" alt="Foto de ${esc(f.autor)} en la comilona" loading="lazy">
                  </button>
                  ${albumTokens[f.id] || adminKey ? `<button class="album__borrar" type="button" data-album-borrar="${f.id}" data-fecha="${iso}" aria-label="Borrar foto">×</button>` : ""}
                </div>`).join("")}</div>`
                : `<p class="album__vacio">Todavía no hay fotos. ¿Nadie sacó el móvil entre el cochinillo y el ponche?</p>`}
            </div>`;
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
                  <div><span class="plaza__nombre">${esc(p.nombre)}</span><span class="plaza__rol">${i === 0 ? "Conduce" : "Va de paquete"}</span>${adminKey && p.telefono ? `<a class="plaza__tel" href="tel:${esc(p.telefono.replace(/\s/g, ""))}">${esc(p.telefono)}</a>` : ""}</div>
                  ${esMia(p) && !pasado ? `<button class="plaza__borrar" data-borrar="${p.id}" data-fecha="${iso}">${adminKey ? "borrar" : "borrarme"}</button>` : ""}
                </div>`).join("")}
              ${!pasado ? Array.from({ length: huecos }, () => `
                <div class="plaza plaza--vacia"><span class="plaza__foto"></span><span>Plaza libre</span></div>`).join("") : ""}
            </div>
            ${bloqueAlbum}
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
      if (!adminKey) return aviso("Las plazas no se borran solas: si no puedes venir, llama al Sheriff.");
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
      return abrirPicker("cambiar", ca.dataset.cambiar);
    }
    const ir = e.target.closest("[data-ir-resto]");
    if (ir) { e.preventDefault(); irARestaurante(ir.dataset.irResto); return; }
    const z = e.target.closest("[data-zoom]");
    if (z) return abrirLightbox([{ src: z.getAttribute("src"), pie: z.dataset.zoom }], 0);
    const as = e.target.closest("[data-album-subir]");
    if (as) return abrirAlbum(as.dataset.albumSubir);
    const av = e.target.closest("[data-album-ver]");
    if (av) {
      const lista = (albums[av.dataset.fecha] || []).map((f) => ({ src: grandeSrc(f), pie: `${f.autor} · ${cap(fmtLargo.format(fecha(av.dataset.fecha)))}` }));
      return abrirLightbox(lista, (albums[av.dataset.fecha] || []).findIndex((f) => f.id === av.dataset.albumVer));
    }
    const ab = e.target.closest("[data-album-borrar]");
    if (ab) {
      if (!confirm("¿Borrar esta foto del álbum?")) return;
      try {
        const r = await store().enviar("DELETE", { accion: "album", fecha: ab.dataset.fecha, fotoId: ab.dataset.albumBorrar, token: albumTokens[ab.dataset.albumBorrar] });
        delete albumTokens[ab.dataset.albumBorrar]; guardarAlbumTokens();
        albums = r.albums; renderViernes(); aviso("Foto borrada.");
      } catch (err) { aviso(err.message, { tipo: "aviso--demo" }); }
    }
  });

  // ---------- Lightbox ----------
  const lightbox = $("#lightbox");
  let lbLista = [], lbIdx = 0;
  function pintarLightbox() {
    const it = lbLista[lbIdx];
    $("#lightbox-fig").innerHTML = `<img src="${esc(it.src)}" alt=""><figcaption>${esc(it.pie)}${lbLista.length > 1 ? ` · ${lbIdx + 1}/${lbLista.length}` : ""}</figcaption>`;
    $("#lb-prev").hidden = $("#lb-next").hidden = lbLista.length < 2;
  }
  function abrirLightbox(lista, idx) {
    lbLista = lista; lbIdx = Math.max(0, idx);
    pintarLightbox();
    lightbox.showModal();
  }
  const lbMover = (d) => { lbIdx = (lbIdx + d + lbLista.length) % lbLista.length; pintarLightbox(); };
  $("#lb-prev").addEventListener("click", (e) => { e.stopPropagation(); lbMover(-1); });
  $("#lb-next").addEventListener("click", (e) => { e.stopPropagation(); lbMover(1); });
  lightbox.addEventListener("click", (e) => { if (!e.target.closest("button")) lightbox.close(); });
  lightbox.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") lbMover(-1); if (e.key === "ArrowRight") lbMover(1); });
  let touchX = null;
  lightbox.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    if (touchX === null || lbLista.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 40) lbMover(dx < 0 ? 1 : -1);
  });

  // ---------- Álbum: subir fotos ----------
  const modalAlbum = $("#modal-album");
  const formAlbum = $("#form-album");
  const aFotos = $("#a-fotos"), aAutor = $("#a-autor"), aLista = $("#a-lista"), aError = $("#a-error");
  let albumFecha = "";
  function abrirAlbum(iso) {
    albumFecha = iso;
    $("#modal-album-titulo").textContent = `Fotos del ${fmtLargo.format(fecha(iso))}`;
    aFotos.value = ""; aLista.textContent = ""; aError.hidden = true;
    try { aAutor.value = localStorage.getItem("jca_nombre") || aAutor.value; } catch {}
    $("#a-enviar").disabled = false; $("#a-enviar").textContent = "Subir";
    modalAlbum.showModal();
  }
  aFotos.addEventListener("change", () => {
    const n = aFotos.files.length;
    aLista.textContent = n ? `${n} ${n === 1 ? "foto elegida" : "fotos elegidas"}` : "";
  });
  formAlbum.addEventListener("submit", async (e) => {
    e.preventDefault();
    aError.hidden = true;
    const files = Array.from(aFotos.files || []);
    if (!files.length) { aError.textContent = "Elige al menos una foto."; aError.hidden = false; return; }
    const autor = aAutor.value.trim() || "Anónimo";
    try { localStorage.setItem("jca_nombre", autor); } catch {}
    const btn = $("#a-enviar");
    btn.disabled = true;
    let subidas = 0;
    try {
      for (const f of files) {
        btn.textContent = `Subiendo ${subidas + 1} de ${files.length}…`;
        const [grande, thumb] = await Promise.all([reducirFoto(f, 1400, false), reducirFoto(f, 360, true)]);
        const token = uuid();
        const r = await store().enviar("POST", { accion: "album", fecha: albumFecha, autor, foto: grande, thumb, token });
        albumTokens[r.fotoId] = token; guardarAlbumTokens();
        albums = r.albums;
        subidas++;
      }
      renderViernes();
      modalAlbum.close();
      aviso(subidas === 1 ? "Foto subida. Qué buena pinta tenía eso." : `${subidas} fotos subidas. Menudo festín.`);
    } catch (err) {
      if (subidas) { renderViernes(); }
      aError.textContent = (subidas ? `Se subieron ${subidas}, pero luego: ` : "") + (err.message || "No se ha podido subir.");
      aError.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Subir";
    }
  });

  // ---------- Modal de reserva ----------
  const modal = $("#modal-reserva");
  const form = $("#form-reserva");
  const fFecha = $("#f-fecha"), fNombre = $("#f-nombre"), fTel = $("#f-tel"), fResto = $("#f-resto"), fFoto = $("#f-foto");
  const fotoPrev = $("#foto-prev"), formError = $("#form-error");
  const picker = $("#picker"), volver = $("#modal-volver");
  let fotoData = "";
  let restoElegido = "", pickerModo = "form", pickerIso = "";

  const enPickerDelForm = () => !picker.hidden && pickerModo === "form";
  function verVista(vista) {
    const enPicker = vista === "picker";
    form.hidden = enPicker; picker.hidden = !enPicker; $("#modal-ok").hidden = true;
    volver.hidden = !enPickerDelForm();
    $("#modal-titulo").textContent = !enPicker ? "Me apunto" : pickerModo === "form" ? "Dónde comemos" : "Cambiar restaurante";
    modal.scrollTop = 0;
  }
  function pintarPicker() {
    const actual = pickerModo === "cambiar" ? (reservas[pickerIso] || {}).restauranteId : restoElegido;
    $("#picker-lista").innerHTML = [3, 2, 1].map((precio) => {
      const grupo = RESTOS.filter((r) => r.precio === precio);
      return grupo.length ? cabeceraPrecio(precio, "h4") + grupo.map((r) => fichaResto(r, { elegible: true, actual: r.id === actual })).join("") : "";
    }).join("");
  }
  function abrirPicker(modo, iso) {
    pickerModo = modo; pickerIso = iso || "";
    pintarPicker();
    verVista("picker");
    if (!modal.open) modal.showModal();
  }
  function pintarCampoResto() {
    const dia = reservas[fFecha.value];
    const conductor = dia && dia.plazas.length ? dia.plazas[0] : null;
    if (conductor) {
      const r = restoPorId(dia.restauranteId);
      fResto.innerHTML = (r ? fichaResto(r) : "") + `<span class="campo__ayuda">Lo eligió ${esc(conductor.nombre)}, que para eso conduce. Toca para ver el sitio.</span>`;
    } else if (restoPorId(restoElegido)) {
      fResto.innerHTML = fichaResto(restoPorId(restoElegido)) + `<button type="button" class="btn btn--outline btn--small" data-abrir-picker>Cambiar</button>`;
    } else {
      fResto.innerHTML = `<button type="button" class="btn btn--outline" data-abrir-picker>Elegir restaurante</button><span class="campo__ayuda">Tú conduces, tú eliges mesa.</span>`;
    }
  }
  fResto.addEventListener("click", (e) => { if (e.target.closest("[data-abrir-picker]")) abrirPicker("form"); });
  volver.addEventListener("click", () => verVista("form"));
  picker.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-elegir]");
    if (!el) return;
    const id = el.dataset.elegir;
    if (pickerModo === "form") {
      restoElegido = id; formError.hidden = true;
      pintarCampoResto();
      return verVista("form");
    }
    const dia = reservas[pickerIso];
    if (!dia || id === dia.restauranteId) return modal.close();
    el.disabled = true;
    try {
      const p = dia.plazas[0];
      const r = await store().enviar("PATCH", { fecha: pickerIso, restauranteId: id, plazaId: p.id, token: tokens[p.id] });
      reservas = r.reservas; renderViernes();
      modal.close(); aviso("Restaurante cambiado para todo el coche.");
    } catch (err) { modal.close(); aviso(err.message, { tipo: "aviso--demo" }); }
  });

  function abrirModal({ fecha: iso, restauranteId } = {}) {
    const conHueco = VIERNES.filter((f) => f >= hoy && (!reservas[f] || reservas[f].plazas.length < MAX_PLAZAS));
    if (!conHueco.length) return aviso("No quedan viernes libres. ¡Vaya éxito!");
    const libres = restauranteId ? conHueco.filter((f) => !reservas[f] || reservas[f].restauranteId === restauranteId) : conHueco;
    if (!libres.length) return aviso(`No queda ningún viernes libre para estrenar ${(restoPorId(restauranteId) || {}).nombre || "ese sitio"}: en los que tienen hueco ya hay mesa elegida.`);
    fFecha.innerHTML = libres.map((f) => {
      const n = reservas[f] ? reservas[f].plazas.length : 0;
      const txt = n === 0 ? "libre, tú conduces" : `${MAX_PLAZAS - n} ${MAX_PLAZAS - n === 1 ? "plaza" : "plazas"}, conduce ${reservas[f].plazas[0].nombre}`;
      return `<option value="${f}">${cap(fmtLargo.format(fecha(f)))} · ${esc(txt)}</option>`;
    }).join("");
    const fija = Boolean(iso && libres.includes(iso));
    fFecha.value = fija ? iso : libres[0];
    fFecha.hidden = fija;
    $("#f-fecha-label").hidden = fija;
    $("#f-fecha-fija").hidden = !fija;
    $("#f-fecha-fija").textContent = fija ? cap(fmtLargo.format(fecha(iso))) : "";
    restoElegido = restauranteId || restoElegido;
    pickerModo = "form";
    actualizarModalFecha();
    verVista("form"); formError.hidden = true;
    try {
      fNombre.value = localStorage.getItem("jca_nombre") || fNombre.value;
      fTel.value = localStorage.getItem("jca_tel") || fTel.value;
    } catch {}
    modal.showModal();
  }
  function actualizarModalFecha() {
    const dia = reservas[fFecha.value];
    const conductor = dia && dia.plazas.length ? dia.plazas[0] : null;
    $("#f-fecha-ayuda").textContent = conductor ? `Vas de paquete con ${conductor.nombre}${dia.plazas.length > 1 ? " y compañía" : ""}. Quedaos en contacto para el punto de recogida.` : "";
    pintarCampoResto();
  }
  fFecha.addEventListener("change", () => actualizarModalFecha());
  $$("[data-cerrar]").forEach((b) => b.addEventListener("click", () => modal.close()));
  $$("[data-cerrar-album]").forEach((b) => b.addEventListener("click", () => $("#modal-album").close()));
  modal.addEventListener("click", (e) => { if (e.target === modal && enPickerDelForm()) verVista("form"); });
  modal.addEventListener("cancel", (e) => { if (enPickerDelForm()) { e.preventDefault(); verVista("form"); } });

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

  function reducirFoto(file, tam, cuadrada = true) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const ctx = c.getContext("2d");
        if (cuadrada) {
          c.width = tam; c.height = tam;
          const s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, tam, tam);
        } else {
          const k = Math.min(1, tam / Math.max(img.width, img.height));
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          ctx.drawImage(img, 0, 0, c.width, c.height);
        }
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
    const telefono = fTel.value.trim();
    if (telefono.replace(/\D/g, "").length < 9) return mostrarError("Deja tu teléfono: solo lo ve el Sheriff, por si hay que llamarte.");
    if (!fotoData) return mostrarError("Sube una foto: es la regla de la casa.");
    const diaPrevio = reservas[fFecha.value];
    const restauranteId = diaPrevio && diaPrevio.plazas.length ? diaPrevio.restauranteId : restoElegido;
    if (!restauranteId) return mostrarError("Elige dónde coméis: tú conduces, tú mandas.");
    const btn = $("#form-enviar");
    btn.disabled = true; btn.textContent = "Reservando…";
    const token = uuid();
    try {
      const r = await store().enviar("POST", { fecha: fFecha.value, nombre, telefono, restauranteId, foto: fotoData, token });
      tokens[r.plazaId] = token; guardarTokens();
      try { localStorage.setItem("jca_nombre", nombre); localStorage.setItem("jca_tel", telefono); } catch {}
      reservas = r.reservas; restoElegido = "";
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

  // ---------- Restaurantes: lista y mapa ----------
  const gridRestos = $("#grid-restos");
  const movil = L.Browser.mobile || matchMedia("(pointer: coarse)").matches;
  const mapa = L.map("mapa", { scrollWheelZoom: false, dragging: !movil, tap: false }).setView([40.9495, -4.1215], 15);
  if (movil) {
    const capa = $("#mapa-toque");
    capa.hidden = false;
    capa.addEventListener("click", () => { mapa.dragging.enable(); capa.hidden = true; });
  }
  // Clave gratuita de basemaps de CARTO (carto.com/basemaps/apikey). Sin ella las teselas
  // salen con la marca de agua "API KEY REQUIRED". Va restringida por dominio en el panel.
  const CARTO_KEY = "cb1_3ric_1_75a8417541456cf404a324b6";
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ""}`, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(mapa);
  L.marker([CAMPUS.lat, CAMPUS.lon], {
    icon: L.divIcon({ className: "", html: `<div class="marker-campus">CAMPUS IE</div>`, iconSize: [90, 26], iconAnchor: [45, 13] }),
    zIndexOffset: 500,
  }).addTo(mapa).bindPopup(`<h4>${CAMPUS.nombre}</h4><div class="pop-meta">Aquí da clase el Sheriff de 16:30 a 19:30.</div>`);

  HITOS.forEach((h) => {
    L.marker([h.lat, h.lon], {
      icon: L.divIcon({ className: "", html: `<div class="marker-hito">${h.icono} ${esc(h.nombre)}</div>`, iconSize: [150, 30], iconAnchor: [75, 15] }),
      zIndexOffset: 400,
    }).addTo(mapa);
  });

  // Rumbo real de Segovia a Madrid, para que la flecha del cartel apunte donde toca.
  const rumboMadrid = (() => {
    const rad = Math.PI / 180;
    const y = (MADRID.lon - CAMPUS.lon) * Math.cos(CAMPUS.lat * rad);
    const x = MADRID.lat - CAMPUS.lat;
    return (Math.atan2(y, x) / rad + 360) % 360;
  })();

  const rosa = L.control({ position: "topright" });
  rosa.onAdd = () => {
    const div = L.DomUtil.create("div", "mapa-brujula");
    div.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M24,7 L29,26 L24,22 L19,26 Z" fill="currentColor"/>
      <path d="M24,41 L19,22 L24,26 L29,22 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    </svg><span>N</span>`;
    return div;
  };
  rosa.addTo(mapa);

  const cartel = L.control({ position: "bottomright" });
  cartel.onAdd = () => {
    const div = L.DomUtil.create("div", "mapa-cartel");
    div.innerHTML = `<svg class="mapa-cartel__flecha" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${rumboMadrid.toFixed(0)}deg)">
      <path d="M12,2 L12,22 M12,2 L6,9 M12,2 L18,9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg><span>Madrid</span>`;
    return div;
  };
  cartel.addTo(mapa);

  const markers = {};
  RESTOS.forEach((r) => {
    const m = L.marker([r.lat, r.lon], {
      icon: L.divIcon({ className: "", html: `<div class="marker-pin" data-marker="${r.id}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      title: r.nombre,
    });
    m.bindPopup(`<h4>${esc(r.nombre)}</h4><div class="pop-meta">${"€".repeat(r.precio)}</div><button class="btn btn--teja btn--small" data-comer="${r.id}">Comer aquí</button>`);
    m.on("click", () => marcarActivo(r.id, true));
    markers[r.id] = m;
  });
  mapa.on("popupclose", () => marcarActivo(null));
  $("#mapa").addEventListener("click", (e) => {
    const b = e.target.closest("[data-comer]");
    if (b) { mapa.closePopup(); abrirModal({ restauranteId: b.dataset.comer }); }
  });

  function renderRestos() {
    gridRestos.innerHTML = [3, 2, 1].map((precio) => cabeceraPrecio(precio, "h3") + RESTOS.filter((r) => r.precio === precio).map((r) => `
      <article class="resto" id="resto-${r.id}" data-resto="${r.id}">
        ${r.foto ? `<img class="resto__foto" src="${esc(r.foto)}" alt="${esc(r.nombre)}" loading="lazy">` : ""}
        <div class="resto__cab">
          <h3 class="resto__nombre">${esc(r.nombre)}</h3>
          <span class="resto__precio" title="${["", "Hasta 30 € por persona", "Entre 30 y 60 € por persona", "Más de 60 € por persona"][r.precio]}">${precioHtml(r)}</span>
        </div>
        <div class="resto__meta">${tagsResto(r)}</div>
        ${cuerpoResto(r)}
        <div class="resto__pie">
          ${enlacesResto(r)}
          <button class="btn btn--teja btn--small" data-comer="${r.id}">Comer aquí</button>
        </div>
      </article>`).join("")).join("");
    RESTOS.forEach((r) => { if (!mapa.hasLayer(markers[r.id])) markers[r.id].addTo(mapa); });
    mapa.fitBounds(L.latLngBounds([[CAMPUS.lat, CAMPUS.lon], ...HITOS.map((h) => [h.lat, h.lon]), ...RESTOS.map((r) => [r.lat, r.lon])]).pad(0.12), { animate: true });
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

  // ---------- Arranque ----------
  async function cargar() {
    try {
      const d = await api.cargar();
      reservas = d.reservas || {};
      albums = d.albums || {};
    } catch (err) {
      demo = true;
      reservas = local.leer();
      albums = local.leerAlbums();
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
