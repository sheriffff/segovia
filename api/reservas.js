import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_PLAZAS = 3;
const KEY = "jca:reservas";
const KEY_ALBUM = "jca:albums";
const FOTO_MAX = 200_000;
const ALBUM_MAX = 900_000;
const ALBUM_FOTOS_MAX = 40;

const VIERNES = (() => {
  const out = [];
  const d = new Date(Date.UTC(2026, 8, 18));
  while (d.getTime() <= Date.UTC(2026, 11, 4)) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
})();

let restauranteIds;
function idsRestaurantes() {
  if (!restauranteIds) {
    try {
      const w = {};
      new Function("window", readFileSync(join(process.cwd(), "data", "restaurantes.js"), "utf8"))(w);
      restauranteIds = new Set((w.RESTAURANTES || []).map((r) => r.id));
    } catch {
      restauranteIds = null;
    }
  }
  return restauranteIds;
}

function redisCliente() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, automaticDeserialization: false });
}

const limpiar = (reservas) => {
  const out = {};
  for (const [fecha, dia] of Object.entries(reservas)) {
    out[fecha] = {
      restauranteId: dia.restauranteId,
      plazas: dia.plazas.map((p) => ({ id: p.id, nombre: p.nombre, fotoId: p.id, creado: p.creado })),
    };
  }
  return out;
};

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const limpiarAlbums = (albums) => {
  const out = {};
  for (const [fecha, fotos] of Object.entries(albums)) out[fecha] = fotos.map((f) => ({ id: f.id, autor: f.autor, creado: f.creado }));
  return out;
};
const jpegBase64 = (v) => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof v === "string" ? v : "");
  return m ? m[1] : null;
};
const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default async function handler(req, res) {
  const redis = redisCliente();
  res.setHeader("cache-control", "no-store");
  if (!redis) return res.status(503).json({ error: "Base de datos no configurada" });

  const leer = async () => JSON.parse((await redis.get(KEY)) || "{}");
  const escribir = (r) => redis.set(KEY, JSON.stringify(r));
  const leerAlbums = async () => JSON.parse((await redis.get(KEY_ALBUM)) || "{}");
  const escribirAlbums = (a) => redis.set(KEY_ALBUM, JSON.stringify(a));
  const enviarImagen = async (clave) => {
    const b64 = await redis.get(clave);
    if (!b64) return res.status(404).end();
    res.setHeader("content-type", "image/jpeg");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    return res.status(200).send(Buffer.from(b64, "base64"));
  };
  const esAdmin = !!process.env.ADMIN_KEY && req.headers["x-admin-key"] === process.env.ADMIN_KEY;

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (q.foto) return enviarImagen(`jca:foto:${texto(q.foto, 64)}`);
      if (q.album) return enviarImagen(`jca:album:${texto(q.album, 64)}`);
      if (q.albumthumb) return enviarImagen(`jca:albumthumb:${texto(q.albumthumb, 64)}`);
      const [reservas, albums] = await Promise.all([leer(), leerAlbums()]);
      return res.status(200).json({ reservas: limpiar(reservas), albums: limpiarAlbums(albums) });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const fecha = texto(body.fecha, 10);
    if (!VIERNES.includes(fecha)) return res.status(400).json({ error: "Ese viernes no está en el calendario" });
    const hoy = new Date().toISOString().slice(0, 10);

    if (body.accion === "album") {
      const albums = await leerAlbums();
      const fotos = albums[fecha] || [];
      if (req.method === "POST") {
        if (fecha > hoy && !esAdmin) return res.status(400).json({ error: "Las fotos se suben después de la comilona, no antes" });
        const autor = texto(body.autor, 40) || "Anónimo";
        const grande = jpegBase64(body.foto);
        const thumb = jpegBase64(body.thumb);
        if (!grande || !thumb) return res.status(400).json({ error: "Falta la foto" });
        if (grande.length > ALBUM_MAX || thumb.length > FOTO_MAX) return res.status(413).json({ error: "La foto es demasiado grande" });
        if (fotos.length >= ALBUM_FOTOS_MAX) return res.status(409).json({ error: "El álbum de ese día está lleno" });
        const id = nuevoId();
        await Promise.all([redis.set(`jca:album:${id}`, grande), redis.set(`jca:albumthumb:${id}`, thumb)]);
        fotos.push({ id, autor, token: texto(body.token, 80), creado: Date.now() });
        albums[fecha] = fotos;
        await escribirAlbums(albums);
        return res.status(201).json({ ok: true, fotoId: id, albums: limpiarAlbums(albums) });
      }
      if (req.method === "DELETE") {
        const fotoId = texto(body.fotoId, 64);
        const foto = fotos.find((f) => f.id === fotoId);
        if (!foto) return res.status(404).json({ error: "Esa foto no existe" });
        if (!esAdmin && !(foto.token && foto.token === texto(body.token, 80))) return res.status(403).json({ error: "Esa foto no es tuya" });
        albums[fecha] = fotos.filter((f) => f.id !== fotoId);
        if (!albums[fecha].length) delete albums[fecha];
        await escribirAlbums(albums);
        await redis.del(`jca:album:${fotoId}`, `jca:albumthumb:${fotoId}`);
        return res.status(200).json({ ok: true, albums: limpiarAlbums(albums) });
      }
      return res.status(405).json({ error: "Método no permitido" });
    }

    if (fecha < hoy && !esAdmin) return res.status(400).json({ error: "Ese viernes ya pasó" });

    const reservas = await leer();
    const dia = reservas[fecha];

    if (req.method === "POST") {
      const nombre = texto(body.nombre, 40);
      const restauranteId = texto(body.restauranteId, 60);
      const token = texto(body.token, 80);
      const foto = typeof body.foto === "string" ? body.foto : "";
      const ids = idsRestaurantes();
      if (nombre.length < 2) return res.status(400).json({ error: "Falta el nombre" });
      if (!restauranteId || (ids && !ids.has(restauranteId))) return res.status(400).json({ error: "Restaurante no válido" });
      if (!token) return res.status(400).json({ error: "Falta el token" });
      const b64 = jpegBase64(foto);
      if (!b64) return res.status(400).json({ error: "Falta la foto" });
      if (b64.length > FOTO_MAX) return res.status(413).json({ error: "La foto es demasiado grande" });
      if (dia && dia.plazas.length >= MAX_PLAZAS) return res.status(409).json({ error: "Ese viernes ya está completo" });

      const id = nuevoId();
      await redis.set(`jca:foto:${id}`, b64);
      const nuevo = dia || { restauranteId, plazas: [] };
      nuevo.plazas.push({ id, nombre, token, creado: Date.now() });
      reservas[fecha] = nuevo;
      await escribir(reservas);
      return res.status(201).json({ ok: true, plazaId: id, reservas: limpiar(reservas) });
    }

    if (!dia) return res.status(404).json({ error: "Ese viernes no tiene reservas" });
    const plazaId = texto(body.plazaId, 64);
    const plaza = dia.plazas.find((p) => p.id === plazaId);
    const autorizado = esAdmin || (plaza && plaza.token && plaza.token === texto(body.token, 80));
    if (!autorizado) return res.status(403).json({ error: "Esa plaza no es tuya" });

    if (req.method === "DELETE") {
      dia.plazas = dia.plazas.filter((p) => p.id !== plazaId);
      if (dia.plazas.length) reservas[fecha] = dia; else delete reservas[fecha];
      await escribir(reservas);
      await redis.del(`jca:foto:${plazaId}`);
      return res.status(200).json({ ok: true, reservas: limpiar(reservas) });
    }

    if (req.method === "PATCH") {
      const restauranteId = texto(body.restauranteId, 60);
      const ids = idsRestaurantes();
      if (!restauranteId || (ids && !ids.has(restauranteId))) return res.status(400).json({ error: "Restaurante no válido" });
      dia.restauranteId = restauranteId;
      await escribir(reservas);
      return res.status(200).json({ ok: true, reservas: limpiar(reservas) });
    }

    res.setHeader("allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Método no permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error del servidor" });
  }
}
