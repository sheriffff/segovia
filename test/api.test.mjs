import { createServer } from "node:http";
import assert from "node:assert/strict";

const datos = new Map();
const fake = createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const ejecutar = ([c, k, v]) => {
      const cmd = String(c).toUpperCase();
      if (cmd === "GET") return { result: datos.has(k) ? datos.get(k) : null };
      if (cmd === "SET") { datos.set(k, v); return { result: "OK" }; }
      if (cmd === "DEL") return { result: datos.delete(k) ? 1 : 0 };
      return { error: "comando no soportado: " + cmd };
    };
    const body = JSON.parse(b);
    const b64 = req.headers["upstash-encoding"] === "base64";
    const codificar = (o) => (b64 && typeof o.result === "string" ? { result: Buffer.from(o.result).toString("base64") } : o);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/pipeline" ? body.map(ejecutar).map(codificar) : codificar(ejecutar(body))));
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = "x";
process.env.ADMIN_KEY = "sheriff";

const { default: handler } = await import("../api/reservas.js");

async function call(method, { body, query = {}, headers = {} } = {}) {
  const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(d) { this.body = d; return this; }, end() { return this; } };
  await handler({ method, body, query, headers }, res);
  return res;
}

const foto = "data:image/jpeg;base64," + Buffer.from("fotofake").toString("base64");
const FECHA = "2026-10-09";

let r = await call("GET");
assert.equal(r.code, 200); assert.deepEqual(r.body.reservas, {});

r = await call("POST", { body: { fecha: "2026-10-10", nombre: "Ana", restauranteId: "x", foto, telefono: "600 111 222", token: "t1" } });
assert.equal(r.code, 400, "fecha que no es viernes");

r = await call("POST", { body: { fecha: FECHA, nombre: "Ana", restauranteId: "x", token: "t1" } });
assert.equal(r.code, 400, "sin foto");

const restos = await import("node:fs").then((fs) => { const w = {}; new Function("window", fs.readFileSync("data/restaurantes.js", "utf8"))(w); return w.RESTAURANTES; });
const rid = restos[0].id, rid2 = restos[1].id;

r = await call("POST", { body: { fecha: FECHA, nombre: "Ana", restauranteId: rid, foto, token: "t1" } });
assert.equal(r.code, 400, "sin teléfono");
r = await call("POST", { body: { fecha: FECHA, nombre: "Ana", restauranteId: rid, foto, telefono: "600 111 222", token: "t1" } });
assert.equal(r.code, 201); const idAna = r.body.plazaId;
assert.equal(r.body.reservas[FECHA].plazas[0].telefono, undefined, "no filtra el teléfono");
r = await call("GET", { headers: { "x-admin-key": "sheriff" } });
assert.equal(r.body.reservas[FECHA].plazas[0].telefono, "600 111 222", "el admin ve el teléfono");
assert.equal(r.body.reservas[FECHA].plazas[0].nombre, "Ana");
assert.equal(r.body.reservas[FECHA].plazas[0].token, undefined, "no filtra el token");

r = await call("GET", { query: { foto: idAna } });
assert.equal(r.code, 200); assert.equal(r.body.toString(), "fotofake");

r = await call("POST", { body: { fecha: FECHA, nombre: "Bea", restauranteId: rid2, foto, telefono: "600 111 222", token: "t2" } });
assert.equal(r.code, 201); assert.equal(r.body.reservas[FECHA].restauranteId, rid, "el segundo no cambia el restaurante");
r = await call("POST", { body: { fecha: FECHA, nombre: "Car", restauranteId: rid, foto, telefono: "600 111 222", token: "t3" } });
assert.equal(r.code, 201); const idCar = r.body.plazaId;
r = await call("POST", { body: { fecha: FECHA, nombre: "Dan", restauranteId: rid, foto, telefono: "600 111 222", token: "t4" } });
assert.equal(r.code, 409, "cuarto no cabe");

r = await call("PATCH", { body: { fecha: FECHA, plazaId: idCar, token: "malo", restauranteId: rid2 } });
assert.equal(r.code, 403);
r = await call("PATCH", { body: { fecha: FECHA, plazaId: idCar, token: "t3", restauranteId: rid2 } });
assert.equal(r.code, 403, "un pasajero no cambia el restaurante");
r = await call("PATCH", { body: { fecha: FECHA, plazaId: idAna, token: "t1", restauranteId: rid2 } });
assert.equal(r.code, 200); assert.equal(r.body.reservas[FECHA].restauranteId, rid2);

r = await call("DELETE", { body: { fecha: FECHA, plazaId: idAna, token: "t9" } });
assert.equal(r.code, 403);
r = await call("DELETE", { body: { fecha: FECHA, plazaId: idAna, token: "t1" } });
assert.equal(r.code, 403, "nadie se borra solo");
r = await call("DELETE", { body: { fecha: FECHA, plazaId: idAna }, headers: { "x-admin-key": "sheriff" } });
assert.equal(r.code, 200); assert.equal(r.body.reservas[FECHA].plazas.length, 2);
assert.equal(r.body.reservas[FECHA].plazas[0].nombre, "Bea", "Bea pasa a conducir");
r = await call("GET", { query: { foto: idAna } });
assert.equal(r.code, 404, "foto borrada");

r = await call("DELETE", { body: { fecha: FECHA, plazaId: idCar }, headers: { "x-admin-key": "sheriff" } });
r = await call("DELETE", { body: { fecha: FECHA, plazaId: r.body.reservas[FECHA].plazas[0].id }, headers: { "x-admin-key": "sheriff" } });
assert.equal(r.body.reservas[FECHA], undefined, "día vacío desaparece");

const grande = "data:image/jpeg;base64," + Buffer.from("fotogrande").toString("base64");
r = await call("POST", { body: { accion: "album", fecha: FECHA, autor: "Ana", foto: grande, thumb: foto, token: "a1" } });
assert.equal(r.code, 400, "antes de la comilona no se sube");
r = await call("POST", { body: { accion: "album", fecha: FECHA, autor: "Ana", foto: grande, thumb: foto, token: "a1" }, headers: { "x-admin-key": "sheriff" } });
assert.equal(r.code, 201); const idFoto = r.body.fotoId;
assert.equal(r.body.albums[FECHA][0].autor, "Ana"); assert.equal(r.body.albums[FECHA][0].token, undefined);
r = await call("GET");
assert.equal(r.body.albums[FECHA].length, 1, "el GET general incluye el álbum");
r = await call("GET", { query: { albumthumb: idFoto } });
assert.equal(r.body.toString(), "fotofake");
r = await call("GET", { query: { album: idFoto } });
assert.equal(r.body.toString(), "fotogrande");
r = await call("DELETE", { body: { accion: "album", fecha: FECHA, fotoId: idFoto, token: "malo" } });
assert.equal(r.code, 403);
r = await call("DELETE", { body: { accion: "album", fecha: FECHA, fotoId: idFoto, token: "a1" } });
assert.equal(r.code, 200); assert.equal(r.body.albums[FECHA], undefined);
r = await call("GET", { query: { album: idFoto } });
assert.equal(r.code, 404);

delete process.env.UPSTASH_REDIS_REST_URL;
r = await call("GET");
assert.equal(r.code, 503);

fake.close();
console.log("API: todas las comprobaciones pasan");
