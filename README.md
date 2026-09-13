# Judiones, Cochinillo y Acueducto

Web para que los colegas del Sheriff reserven un viernes de otoño en Segovia: coche, comilona, paseo y vuelta a Madrid.

- `index.html`, `styles.css`, `app.js`: la web, HTML estático sin build.
- `data/restaurantes.js`: los restaurantes (tipo, precio, coordenadas, minutos andando al campus IE).
- `api/reservas.js`: función de Vercel que guarda las reservas y las fotos en Upstash Redis.
- `img/`: fotos de Wikimedia Commons con licencia libre (créditos en el pie de la web).

## Cómo funciona la reserva

Cada viernes admite un coche con tres plazas. El primero que se apunta conduce y elige restaurante; los siguientes ven su foto y su nombre. Cada reserva lleva una foto obligatoria (se reduce a 360 px en el navegador antes de subirse). Quien reserva puede borrar su plaza desde el mismo navegador; el Sheriff puede borrar cualquiera entrando una vez en `/?admin=CLAVE` con la clave definida en la variable `ADMIN_KEY`.

A partir del día de cada comilona, la tarjeta de ese viernes muestra un álbum: cualquiera puede subir fotos (se reducen a 1400 px en el móvil) y verlas a tamaño completo. Quien sube una foto puede borrarla desde su navegador; el Sheriff, cualquiera.

Si la base de datos no está conectada, la web funciona en modo demo y guarda las reservas solo en el navegador.

## Desplegar en Vercel

```bash
npm i -g vercel@latest
vercel login
vercel link --yes
vercel integration add upstash/upstash-kv --yes --no-claim
vercel env add ADMIN_KEY production
vercel --prod
```

La integración de Upstash crea la base de datos y añade sola las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` al proyecto. Si prefieres hacerlo desde el panel: proyecto → Storage → Create → Upstash for Redis → Connect.

## Probar en local

```bash
npm install
vercel env pull .env.local
vercel dev
```

Sin Vercel, abre `index.html` directamente: verás la web en modo demo.

```bash
npm test
```

El test levanta un Redis falso en memoria y comprueba la API de reservas de punta a punta.
