import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_PLAZAS = 3;
const KEY = "jca:reservas";
const FOTO_MAX = 200_000;

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

export default async function handler(req, res) {
  const redis = redisCliente();
  res.setHeader("cache-control", "no-store");
  if (!redis) return res.status(503).json({ error: "Base de datos no configurada" });

  const leer = async () => JSON.parse((await redis.get(KEY)) || "{}");
  const escribir = (r) => redis.set(KEY, JSON.stringify(r));
  const esAdmin = !!process.env.ADMIN_KEY && req.headers["x-admin-key"] === process.env.ADMIN_KEY;

  try {
    if (req.method === "GET") {
      const fotoId = req.query && req.query.foto;
      if (fotoId) {
        const b64 = await redis.get(`jca:foto:${texto(fotoId, 64)}`);
        if (!b64) return res.status(404).end();
        res.setHeader("content-type", "image/jpeg");
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
        return res.status(200).send(Buffer.from(b64, "base64"));
      }
      return res.status(200).json({ reservas: limpiar(await leer()) });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const fecha = texto(body.fecha, 10);
    if (!VIERNES.includes(fecha)) return res.status(400).json({ error: "Ese viernes no está en el calendario" });
    const hoy = new Date().toISOString().slice(0, 10);
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
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(foto);
      if (!m) return res.status(400).json({ error: "Falta la foto" });
      if (m[1].length > FOTO_MAX) return res.status(413).json({ error: "La foto es demasiado grande" });
      if (dia && dia.plazas.length >= MAX_PLAZAS) return res.status(409).json({ error: "Ese viernes ya está completo" });

      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      await redis.set(`jca:foto:${id}`, m[1]);
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
