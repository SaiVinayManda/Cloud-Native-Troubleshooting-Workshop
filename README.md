# Cloud Native Troubleshooting Workshop

A hands-on, 50–65 minute lab: run a containerized storefront, break its catalog connection, use logs to identify the cause, and prove the repair. Complete the Docker exercise first, then repeat the incident in Kubernetes.

**The incident:** a configuration change points the storefront at catalog port `9090`; the catalog actually listens on `8081`. The process stays alive, but customer requests fail with HTTP 503. No cloud account, database, or paid service is needed.

## Learning objectives

By the end, you can:

- Build an image and run a two-service application with Docker Compose.
- Distinguish a running process, a healthy container, a ready Pod, and a working customer request.
- Correlate a failed HTTP request with structured logs using a request ID.
- Test a dependency from inside the affected container or Pod.
- Diagnose and repair an incorrect environment variable or ConfigMap.
- Verify recovery through repeated HTTP requests, readiness, and fresh logs.

## Start here

1. [Check prerequisites and the architecture](docs/01-setup.md) — 5 minutes.
2. [Run, break, diagnose, and repair with Docker](docs/02-docker-lab.md) — 20 minutes.
3. [Repeat with Kubernetes](docs/03-kubernetes-lab.md) — 20–30 minutes.
4. [Practice other failure scenarios](docs/04-troubleshooting.md) — 10 minutes.
5. [Watch the 2-minute recorded walkthrough](media/walkthrough.html) or [open the WebM recording](media/walkthrough.webm). [Transcript and recording notes](docs/05-walkthrough.md).

Quick Docker start, from this repository's root:

```sh
docker compose up -d --build --wait --wait-timeout 120
docker compose ps
docker compose exec storefront node app/probe.mjs http://127.0.0.1:8080/api/catalog 200 lab-baseline
```

Open **http://localhost:8080**. To finish, run `docker compose down --remove-orphans`.

![The running storefront returns a successful catalog response](media/screenshots/01-docker-healthy.png)

## What is included

| Path | Purpose |
| --- | --- |
| [app/](app/) | Node.js HTTP application, browser UI, health check, and portable HTTP probe; no runtime packages |
| [Dockerfile](Dockerfile) | Non-root image with a dependency-aware health check |
| [compose.yaml](compose.yaml) | Local catalog and storefront, exposed on loopback only |
| [k8s/](k8s/) | Namespace, ConfigMap, Deployments, Services, resource limits, and probes |
| [scenarios/](scenarios/) | Repeatable bad-port configuration for both runtimes |
| [docs/](docs/) | Learner instructions, expected output, diagnosis, verification, and cleanup |
| [media/](media/) | Actual screenshots, captioned screen recording, and captured command evidence |
| [tests/](tests/) | HTTP integration tests, including fault, recovery, and timeout behavior |
| [scripts/](scripts/) | Configuration checks and reproducible media capture |

## Maintainer checks

Host Node.js 22+ is only needed for development and media capture. In Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks `npm` or `npx`.

```sh
npm ci
npm test
npm run validate
docker compose config --quiet
```

See [the validation record](docs/06-validation.md) for the tested environment, results, and media provenance.
