# 5. Recorded walkthrough

[Open the video player](../media/walkthrough.html) · [Download/open the WebM](../media/walkthrough.webm) · [English captions](../media/walkthrough.vtt)

**Duration:** approximately 2 minutes 10 seconds. **Format:** 1600 × 1000 WebM. This is a screen recording of the actual application and command results from the local Docker and kind exercises. Explanations are embedded on screen and also provided as a synchronized caption track. There is no audio. Build and cluster setup happen before the recording; their command output is preserved with the other evidence.

The recording uses a browser display for the live application and executed command output. Long output is excerpted to fit the screen. [The full session transcript](../media/evidence/session.txt) and [structured command results](../media/evidence/commands.json) contain the original output and exit codes. Kubernetes screenshots expand the output panel so the diagnostic evidence remains visible.

## Chapters and transcript

| Start | What to observe | Explanation |
| --- | --- | --- |
| 00:00 | Docker baseline | Two healthy containers. The storefront returns HTTP 200 and three products. A request ID connects the HTTP result with its logs. |
| 00:07 | Inject the wrong port | The override changes `CATALOG_URL` to `http://catalog:9090`. The page shell loads, but `/api/catalog` returns HTTP 503. |
| 00:16 | Diagnose the incident | The `lab-broken` log contains `ECONNREFUSED` and the configured upstream. A request from inside storefront to catalog port 8081 succeeds. The configuration points to the wrong port. |
| 00:36 | Repair Docker | Recreate storefront using the known-good base configuration. Readiness returns 200; three new customer requests succeed and appear in fresh logs. |
| 00:57 | Kubernetes baseline | Both Pods are ready. A request from the catalog Pod through the storefront Service returns HTTP 200. |
| 01:04 | Diagnose the unready Pod | Apply the bad ConfigMap and replace the storefront Pod. Rollout times out. The Pod is Running but 0/1 ready, with zero restarts. Pod-local liveness succeeds; readiness fails; catalog at 8081 works. The Service endpoint is unready. In this run, the bad Service port produces `TimeoutError`. |
| 01:41 | Repair Kubernetes | Restore the ConfigMap and replace the Pod. Both Pods become ready; repeated requests through the Service succeed. The EndpointSlice reports `ready: true`, and fresh request logs show HTTP 200. |

The recorded rollout waits 15 seconds before the expected failure; the learner guide allows 30 seconds. Both demonstrate the same readiness failure. Timings, generated Pod names, and request IDs will differ in your run.

## Recreate the media

Complete the setup and create the dedicated kind cluster first. The capture script uses only the `kind-troubleshooting-lab` context and `troubleshooting-lab` namespace. It builds the image, loads it into the named kind cluster, and intentionally runs both fault-and-repair cycles. It leaves both runtimes healthy for inspection. Cleanup commands are in each lab guide.

Install the development packages and Playwright's small video encoder. An installed Google Chrome is the default capture browser.

```sh
npm ci
```

PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache/ms-playwright'
npx.cmd playwright install ffmpeg
node scripts/capture-walkthrough.mjs
```

Bash:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" npx playwright install ffmpeg
node scripts/capture-walkthrough.mjs
```

For another installed browser, set `BROWSER_CHANNEL=msedge`. Set `LAB_KUBECONFIG` to use an explicit kubeconfig file and `KIND_BIN` if kind is outside PATH. If present, the script automatically uses workspace-local `artifacts/kubeconfig` and `.tools/kind.exe`. Neither is committed. It does not create a cluster or change the active kubectl context.

The capture writes the screenshots, WebM, VTT captions, and full evidence into `media/`. Temporary encoder video files remain under ignored `artifacts/`. After capture, synchronize the external caption track to the recorded title transitions and check playback:

```sh
node scripts/verify-media.mjs --sync-captions
npm run validate
```

`npm run verify:media` checks playback, dimensions, seven caption cues, and decoded sample frames without changing captions. QA frames and metadata are saved under ignored `artifacts/media-qa/`.
