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

## Automated unprivileged OVH staging (operational)

Workflow: `.github/workflows/ovh-landing-userspace-deploy.yml` on staging branch pushes.
It uses the dedicated `liftorbit-ci` SSH key from GitHub Actions repository secrets,
transfers a checked-out source bundle and pinned Bun runtime, and runs a second
staging copy at `127.0.0.1:18081` under `liftorbit-ci` (no sudo or Docker).
The server code is patched at build time to bind to loopback and permit
only the matching localhost preview Origin.

`18080` still runs the original, root-owned Docker staging container.
The CI user cannot update it and must not be added to the Docker group.

GitHub Actions checks `/health` after installation and via a new SSH connection.
The deployment workflow also configures the dedicated user's crontab to
relaunch the userspace staging instance on reboot and check it every five minutes.
Crontab installation needs to be confirmed through a separate remote probe
before declaring reboot persistence verified.

These staging workflows must never be used as evidence that the primary
`app.liftorbit.app` runtime, Python GA optimizer, or either PostgreSQL database
has been migrated. All of those remain on Railway.
