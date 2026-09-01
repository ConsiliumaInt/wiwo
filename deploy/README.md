# Hetzner deployment

WIWO is configured to run behind `consiliuma.co.uk/wiwo`.

1. Copy this `wiwo` directory to the Hetzner host.
2. Put real credentials in `wiwo/.env.local` (never commit it).
3. Run `docker compose up -d --build`.
4. Reverse proxy `/wiwo` to `http://127.0.0.1:3020`.

For nginx, proxy both `/wiwo` and `/wiwo/` and preserve websocket/SSE connections:

```nginx
location /wiwo/ {
    proxy_pass http://127.0.0.1:3020/wiwo/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

The current project stores run state in the mounted `wiwo-data` volume. For a multi-instance deployment, replace the file store with a shared database before scaling horizontally.
