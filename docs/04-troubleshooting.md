# 4. Common failures and additional practice

Start with the symptom, gather evidence, make one change, and repeat the original request. A ready Pod or a healthy container is useful evidence; the customer workflow is the final check.

## Symptom → evidence → action

| Symptom | Evidence to collect | Likely cause and repair |
| --- | --- | --- |
| Cannot connect to Docker daemon | `docker version`, Docker Desktop engine status | Start the engine; select Linux containers. Wait for a Server section before retrying. |
| Host port 8080 already allocated | `docker ps`, the startup error, other port-forward terminals | Stop the earlier lab or use another host port. A Compose port mapping changes the host port only; keep the container port 8080. |
| Browser page loads, catalog is 503 | Storefront JSON logs and `printenv CATALOG_URL` | Bad catalog configuration; verify catalog on 8081 from inside storefront, then recreate/roll out the corrected configuration. |
| `ECONNREFUSED` | `upstream` in logs, Service/container ports | A connection reached a host with no listener at that port, or was actively rejected. Compare port configuration; do not assume DNS is broken. |
| `ENOTFOUND` / `EAI_AGAIN` | Configured hostname and DNS from the affected container | Misspelled service name, different network/namespace, or DNS unavailable. Use `catalog` in the shared Compose network or Kubernetes namespace. |
| `TimeoutError` | Dependency response time and network policy/firewall evidence | A slow or unreachable dependency exceeded the 1.2 s request budget. Restore dependency/network health; increasing a timeout alone does not establish the cause. |
| Docker stays unhealthy | `docker inspect troubleshooting-lab-storefront-1 --format '{{json .State.Health}}'` | Read the probe output. A process can run while `/readyz` returns 503. Fix the dependency and wait for the next successful check. |
| ConfigMap is correct, Pod still uses wrong URL | Compare ConfigMap with `exec deployment/storefront -- printenv CATALOG_URL` | Environment values are read at startup. Restart the Deployment after correcting the ConfigMap. |
| `ErrImageNeverPull` | `kubectl ... describe pods -l app=storefront` | Local image was not loaded into this cluster. Run `kind load docker-image troubleshooting-storefront:1.0 --name troubleshooting-lab`. |
| `ImagePullBackOff` | Pod events, image name/tag, pull policy | An image configured for pulling is unavailable or unauthorized. For the supplied manifests restore `Never` and load the local image. |
| Pod is Pending | `describe pod` scheduling events and node status | Insufficient memory/CPU or an unready node. Free local capacity or increase Docker Desktop resources. |
| `CrashLoopBackOff` | `logs <pod> --previous`, `describe pod`, exit code | Process exits or liveness fails. Inspect the previous container's logs. The supplied bad-port fault should produce Running/0 ready, not a crash loop. |
| Service request fails but Pod-local request works | Service selector, EndpointSlice `ready`, target port | No ready endpoints, a selector mismatch, or incorrect target port. In this lab, dependency failure intentionally makes the storefront endpoint unready. |
| Connection briefly fails after recreation | Container/Pod startup state | Wait for startup/readiness; then repeat the probe. Do not treat a connection during replacement as the final test result. |

In Kubernetes rows, use `kubectl --context kind-troubleshooting-lab -n troubleshooting-lab` before the command fragment.

## Optional exercise A — Stop the dependency (Docker)

Begin from a healthy Docker baseline.

```sh
docker compose stop catalog
docker compose exec storefront node app/probe.mjs http://127.0.0.1:8080/api/catalog 503 dependency-stopped
docker compose logs --tail=20 storefront
docker compose start catalog
docker compose up -d --wait --wait-timeout 60
docker compose exec storefront node app/probe.mjs http://127.0.0.1:8080/api/catalog 200 dependency-restored
```

Expect a dependency error while catalog is stopped; the exact DNS/connection code can vary with runtime behavior. Storefront does not need recreation when its unchanged URL becomes reachable again. Verify readiness and three successful requests as in the main exercise.

## Optional exercise B — Remove all catalog replicas (Kubernetes)

Begin from a healthy Kubernetes baseline.

```sh
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab scale deployment/catalog --replicas=0
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab get pods,svc
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab exec deployment/storefront -- node app/probe.mjs http://127.0.0.1:8080/api/catalog 503 catalog-scaled-down
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab scale deployment/catalog --replicas=1
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab rollout status deployment/catalog --timeout=90s
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab wait --for=condition=Ready pods -l app=storefront --timeout=90s
kubectl --context kind-troubleshooting-lab -n troubleshooting-lab exec deployment/catalog -- node app/probe.mjs http://storefront:8080/api/catalog 200 catalog-restored
```

The Service object remains while its catalog Pods disappear. The storefront's readiness should recover automatically when catalog returns. A brief request during Pod termination can still succeed; wait until `get pods` shows catalog gone before the failing probe.

## Completion evidence

Record a brief incident note:

```text
Symptom: customer request ... returned ...
Evidence: request ID ..., upstream ..., error code ...
Root cause: ...
Repair: ...
Verification: readiness ..., 3 customer requests ..., fresh logs ...
```

Answer these questions: What proved the catalog itself was healthy? Why did the page still load? Why did Pod restart count stay at zero? Which command made the corrected environment take effect?
