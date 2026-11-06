# LiftOrbit - OVH landing rehearsal

This is a **staging-only** Docker Compose configuration for the LiftOrbit marketing landing.
It starts from the exact Railway landing commit `d42e3b11240d7ecc11526a64261bc9ccb1d2505a`.

## Safety

- No Railway environment, service, volume, or domain is changed.
- No public ports are exposed: bind `127.0.0.1:18080` only.
- No database credentials, application sessions, or GA engines are used.
- Container runs with a read-only filesystem, no Linux capabilities, a 256 MiB memory limit, and a 0.5 vCPU cap.
- Docker access is currently *not* granted to `liftorbit-ci`. **Do not add this user to the docker group casually:** Docker daemon access is root-equivalent.

## Build/smoke on GitHub

Pushes to this staging branch run `ovh-landing-build-smoke.yml`. This builds the image,
checks the health endpoint and the landing response, and validates the Compose file.
It does not deploy to OVH.

## Deploy after audit

Once GitHub build/smoke passes, provision a restricted deploy path and transfer this
staging build to OVH. The exact command on an authorized Docker-capable account, from
the root of this source tree, will be:

```sh
docker compose -f ops/ovh/landing.compose.yaml up -d --build
docker compose -f ops/ovh/landing.compose.yaml ps
curl --fail --silent http://127.0.0.1:18080/health
```

When running over SSH without public HTTP, check via SSH port forwarding, e.g.
`ssh -L 18080:127.0.0.1:18080 ubuntu@51.255.163.121`.
**Do not** switch Cloudflare DNS until independent acceptance tests pass.

## Other services not yet ported

- `app.liftorbit.app` still runs through the Railway auth-integration service.
- Its auth and plan-gateway upstreams are Railway services.
- Python GA source is assembled from Railway environment variables.
- Two separate Postgres volumes exist on Railway and require inspection and backups.

Do not move these with untested images or copy production secrets into GitHub.
