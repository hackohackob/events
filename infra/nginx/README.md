# Primary domain: academyfirstaid.com

The stack is served on **academyfirstaid.com** (the apps build against this API):

| Subdomain                         | Proxies to        | Serves                  |
| --------------------------------- | ----------------- | ----------------------- |
| `events.academyfirstaid.com`      | `127.0.0.1:8892`  | Coordinator web         |
| `events-api.academyfirstaid.com`  | `127.0.0.1:8891`  | Backend API + realtime  |
| `sos.academyfirstaid.com`         | `127.0.0.1:8894`  | Runner Companion PWA    |
| `race.academyfirstaid.com`        | `127.0.0.1:8894`  | Same PWA (alias of sos) |

The legacy `*.hackohackob.com` vhosts are kept as working aliases. One-time VPS
setup (already applied):

```bash
sudo cp /opt/events/infra/nginx/academyfirstaid.conf \
        /etc/nginx/sites-available/academyfirstaid.conf
sudo ln -sf /etc/nginx/sites-available/academyfirstaid.conf \
            /etc/nginx/sites-enabled/academyfirstaid.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx \
  -d events.academyfirstaid.com -d events-api.academyfirstaid.com \
  -d sos.academyfirstaid.com -d race.academyfirstaid.com \
  --non-interactive --agree-tos -m hackohackob@gmail.com --redirect
```

Certbot's systemd timer auto-renews. `certbot --nginx` rewrites the vhost in
place to add the 443 blocks + 80→443 redirects (so the checked-in file stays the
plain HTTP version, like `pwa.hackohackob.com.conf`).

---

# VPS setup for pwa.hackohackob.com (one-time)

CI builds `hackohackob1/events-runner:latest` and runs it on the host at
`127.0.0.1:8894` (see `docker-compose.prod.yml`). These steps wire the public
domain + TLS to that container. Run them once on the VPS (`hacko@hackohackob.com`).

### 1. DNS
Add an A record (and AAAA if you use IPv6) for `pwa` pointing at the VPS IP —
the same target as `events-api` / the coordinator web domain.

### 2. nginx reverse proxy
```bash
sudo cp /opt/events/infra/nginx/pwa.hackohackob.com.conf \
        /etc/nginx/sites-available/pwa.hackohackob.com.conf
sudo ln -sf /etc/nginx/sites-available/pwa.hackohackob.com.conf \
            /etc/nginx/sites-enabled/pwa.hackohackob.com.conf
sudo nginx -t && sudo systemctl reload nginx
```
(If this VPS uses `/etc/nginx/conf.d/` instead of `sites-available`, drop the
file there and skip the symlink — match whatever `events-api` already does.)

### 3. TLS via Let's Encrypt
```bash
sudo certbot --nginx -d pwa.hackohackob.com
```
Certbot edits the config in place to add the `listen 443 ssl` block and the
HTTP→HTTPS redirect. Auto-renewal is already handled by the certbot systemd timer.

### 4. GitHub secrets (already present for the existing deploy)
The deploy job reuses the same repository secrets the rest of the stack uses —
no new secrets are needed for the runner:
- `DOCKER_PASSWORD` — Docker Hub push
- `SSH_PASSWORD` — VPS deploy (appleboy scp/ssh actions)

After this, every push to `master` rebuilds and redeploys the PWA automatically.
The first deploy pulls the new `events-runner` image and `docker-compose up -d`
starts it on 8894; nginx already proxies the domain to it.
