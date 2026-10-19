# 6. Validation record

The lab was executed locally on **19 October 2026, Europe/Berlin** (18 October UTC). Screenshots and video use real application responses and command results; the Kubernetes capture uses an isolated kind cluster and a workspace-local kubeconfig.

## Environment

| Component | Tested version |
| --- | --- |
| Host | Windows, PowerShell |
| Host Node.js | 22.19.0 |
| Docker Engine | 28.0.4, Linux containers |
| Docker Compose | 2.34.0-desktop.1 |
| kind | 0.27.0 |
| Kubernetes server / kubectl | 1.32.2 / 1.32.2 |
| Container base | `node:22-alpine`; resolved image digest is in the recorded build output |

## Executed checks

| Check | Result |
| --- | --- |
| `npm test` | 3 integration tests passed: healthy/fault/recovery, timeout with healthy liveness, and HTTP error handling |
| Base and merged Compose configuration | Accepted by `docker compose config --quiet` |
| YAML and local Markdown/media links | Checked with `npm run validate` |
| Docker baseline | Both containers healthy; HTTP 200 and three products |
| Docker injected fault | HTTP 503, correlated `ECONNREFUSED` log, unhealthy storefront, healthy catalog |
| Docker repair | Ready; three consecutive HTTP 200 customer requests with matching successful logs |
| Kubernetes baseline | Both Pods ready; customer request through storefront Service succeeds |
| Kubernetes injected fault | Rollout timeout expected; storefront Running/0 ready with stable restart count; HTTP 503; live process; catalog reachable at 8081; endpoint `ready: false` |
| Kubernetes repair | Rollout completes; three HTTP 200 Service requests; successful fresh logs; endpoint `ready: true` |
| Browser | Desktop healthy/broken/fixed screens and a 390 px mobile layout without horizontal overflow |
| Media | Six PNG screenshots; WebM playback verified at 1600 × 1000, 129.56 seconds; seven synchronized caption cues and seven decoded sample frames inspected |

The Kubernetes bad-port connection timed out rather than returning an immediate refusal. The instructions explain why network-level symptoms can vary while the misconfigured port remains the cause.

## Evidence and limits

- [Full command transcript](../media/evidence/session.txt), including the expected failed rollout and successful verification requests.
- [Structured command records](../media/evidence/commands.json), with timestamps and exit codes.
- [Recorded chapters](../media/evidence/chapters.json), [video](../media/walkthrough.webm), and [screenshots](../media/screenshots/).
- The Docker and Kubernetes tracks were executed. Linux/macOS host shells and the optional extra failure exercises were not separately executed in this validation run.
- The recording is silent with embedded explanations and an optional VTT track.

The capture leaves the demonstration resources healthy. Use the cleanup steps in the [Docker](02-docker-lab.md) and [Kubernetes](03-kubernetes-lab.md) guides when finished.

In the original capture workspace, inspect the existing Kubernetes resources without changing your default kubeconfig:

```sh
kubectl --kubeconfig artifacts/kubeconfig --context kind-troubleshooting-lab -n troubleshooting-lab get pods
```

The capture workspace also has a checksum-verified kind executable at `.tools/kind.exe`; this local tool and the kubeconfig are ignored by Git. A fresh clone needs kind installed as described in setup.
