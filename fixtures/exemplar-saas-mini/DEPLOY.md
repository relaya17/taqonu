# Deploy (BYO)

Run `node src/server.mjs` behind HTTPS (Caddy/nginx). Set `COOKIE_SECRET` (≥32) and `APP_VERSION`. Terminate TLS at the proxy. Do not expose the process port publicly without a reverse proxy.
