import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// This captures actual local Docker / Kubernetes executions. No command output is mocked.
// Requires the dedicated kind cluster from docs/03-kubernetes-lab.md and installed Chrome.
const execute = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/ms-playwright');
// Playwright resolves its encoder directory at import time.
const { chromium } = await import('playwright');
const exists = (path) => access(path).then(() => true, () => false);
await mkdir('media/screenshots', { recursive: true });
await mkdir('media/evidence', { recursive: true });
await mkdir('artifacts/video', { recursive: true });
const kubeconfig = process.env.LAB_KUBECONFIG || (await exists('artifacts/kubeconfig') ? 'artifacts/kubeconfig' : undefined);
const kube = [...(kubeconfig ? ['--kubeconfig', kubeconfig] : []), '--context', 'kind-troubleshooting-lab', '-n', 'troubleshooting-lab'];
const kind = process.env.KIND_BIN || (await exists('.tools/kind.exe') ? resolve('.tools/kind.exe') : 'kind');
const evidence = [];
let page, context, browser;
let terminal = '';
let epoch;
const chapters = [];

async function command(program, args, { allowFailure = false, display, append = false } = {}) {
  const shown = `$ ${program === kind ? 'kind' : program} ${args.join(' ')}`;
  if (page) {
    terminal = append ? `${terminal}\n\n${shown}\nRunning…` : `${shown}\nRunning…`;
    await page.locator('#terminal').evaluate((element, value) => { element.textContent = value; element.scrollTop = element.scrollHeight; }, terminal);
  }
  const startedAt = new Date().toISOString();
  let stdout = '', stderr = '', exitCode = 0;
  try {
    ({ stdout, stderr } = await execute(program, args, { cwd: process.cwd(), env: process.env, timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    stdout = error.stdout || ''; stderr = error.stderr || ''; exitCode = error.code ?? 1;
    if (!allowFailure) throw new Error(`${shown}\n${stdout}\n${stderr}`, { cause: error });
  }
  const output = `${stdout}${stderr}`.trim();
  evidence.push({ startedAt, endedAt: new Date().toISOString(), program: program === kind ? 'kind' : program, args, exitCode, output });
  await writeFile('media/evidence/commands.json', `${JSON.stringify(evidence, null, 2)}\n`);
  if (page) {
    const visible = display ? display(output) : output;
    terminal = terminal.replace(/Running…$/, `${visible}\n[exit ${exitCode}]`);
    await page.locator('#terminal').evaluate((element, value) => { element.textContent = value; element.scrollTop = element.scrollHeight; }, terminal);
  }
  return { output, exitCode };
}
const docker = (args, options) => command('docker', args, options);
const kubectl = (args, options) => command('kubectl', [...kube, ...args], options);
// Display selected original response lines so the evidence fits; full JSON is saved unmodified.
const compactProbe = (output) => output.split('\n').filter((line) => /HTTP |"status"|"name"|"requestId"|"error"/.test(line)).join('\n');
const dProbe = (url, status = 200, id, options) => docker(['compose', 'exec', '-T', 'storefront', 'node', 'app/probe.mjs', url, String(status), ...(id ? [id] : [])], { display: compactProbe, ...options });
const kProbe = (deployment, url, status = 200, id, options) => kubectl(['exec', `deployment/${deployment}`, '--', 'node', 'app/probe.mjs', url, String(status), ...(id ? [id] : [])], { display: compactProbe, ...options });

async function waitFor(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await sleep(500);
  }
  throw new Error(`Timed out: ${label}`, { cause: lastError });
}
async function chapter(title, caption, mode = 'docker') {
  const start = (Date.now() - epoch) / 1000;
  if (chapters.length) chapters.at(-1).end = start;
  chapters.push({ title, caption, start });
  terminal = '';
  await page.evaluate(({ title, caption, mode, index }) => {
    document.getElementById('title').textContent = title;
    document.getElementById('caption').textContent = caption;
    document.getElementById('phase').textContent = `STEP ${index} / 7 · ${mode.toUpperCase()}`;
    document.body.dataset.mode = mode;
    document.getElementById('terminal').textContent = '';
  }, { title, caption, mode, index: chapters.length });
  console.log(title);
}
async function reloadApp() {
  const frame = page.frameLocator('#app');
  await page.locator('#app').evaluate((element) => { element.src = `http://127.0.0.1:8080/?capture=${Date.now()}`; });
  await frame.locator('#request:enabled').waitFor();
}
async function screenshotApp(name, status) {
  const shot = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  try {
    await shot.goto('http://127.0.0.1:8080/');
    await shot.locator('#request:enabled').waitFor();
    if ((await shot.locator('#http').innerText()) !== `HTTP ${status}`) throw new Error(`UI expected HTTP ${status}`);
    await shot.screenshot({ path: `media/screenshots/${name}.png`, fullPage: true });
  } finally { await shot.close(); }
}
async function screenshotTerminal(name) {
  const shot = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await shot.setContent(await page.content());
    await shot.addStyleTag({ content: '.grid{height:auto}pre{height:auto;min-height:590px;overflow:visible}' });
    await shot.screenshot({ path: `media/screenshots/${name}.png`, fullPage: true });
  } finally { await shot.close(); }
}

try {
  // Preparation is deliberately outside the recording; build noise is preserved in the evidence.
  console.log('Preparing image and healthy Docker / Kubernetes baselines…');
  await docker(['build', '-t', 'troubleshooting-storefront:1.0', '.']);
  await docker(['compose', '-f', 'compose.yaml', 'up', '-d', '--wait', '--wait-timeout', '90']);
  await command(kind, ['load', 'docker-image', 'troubleshooting-storefront:1.0', '--name', 'troubleshooting-lab']);
  await kubectl(['apply', '-f', 'k8s/00-namespace.yaml']);
  await kubectl(['apply', '-f', 'k8s/']);
  for (const deployment of ['catalog', 'storefront']) {
    await kubectl(['rollout', 'restart', `deployment/${deployment}`]);
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--timeout=90s']);
  }
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: 'artifacts/video', size: { width: 1600, height: 1000 } } });
  epoch = Date.now();
  page = await context.newPage();
  await page.setContent(await readFile('scripts/recording-stage.html', 'utf8'));

  await chapter('01 / Establish a healthy baseline', 'Two healthy containers and a real customer request returning HTTP 200.');
  await reloadApp();
  await docker(['compose', 'ps']);
  await dProbe('http://127.0.0.1:8080/api/catalog', 200, 'lab-baseline', { append: true });
  await screenshotApp('01-docker-healthy', 200);
  await sleep(6000);

  await chapter('02 / Introduce the bad port', 'The override changes CATALOG_URL to catalog:9090. The HTML page still loads; the customer request fails.');
  await docker(['compose', '-f', 'compose.yaml', '-f', 'scenarios/compose.bad-port.yaml', 'up', '-d', '--no-deps', '--force-recreate', 'storefront']);
  await waitFor(async () => (await fetch('http://127.0.0.1:8080/api/catalog')).status === 503, 'broken storefront');
  await reloadApp();
  await dProbe('http://127.0.0.1:8080/api/catalog', 503, 'lab-broken');
  await screenshotApp('02-docker-broken', 503);
  await sleep(6000);

  await chapter('03 / Diagnose from evidence', 'ECONNREFUSED points to catalog:9090. The same container can reach catalog:8081: the configured port is wrong.');
  await docker(['compose', 'logs', '--no-color', '--tail=50', 'storefront'], { display: (output) => output.split('\n').filter((line) => line.includes('lab-broken') && line.includes('dependency_failed')).join('\n') });
  await docker(['compose', 'exec', '-T', 'storefront', 'printenv', 'CATALOG_URL'], { append: true });
  await dProbe('http://catalog:8081/items', 200, undefined, { append: true });
  await waitFor(async () => {
    const { stdout } = await execute('docker', ['inspect', 'troubleshooting-lab-storefront-1', '--format', '{{.State.Health.Status}}'], { windowsHide: true });
    return stdout.trim() === 'unhealthy';
  }, 'Docker unhealthy');
  await docker(['compose', 'ps'], { append: true });
  await sleep(7000);

  await chapter('04 / Repair and verify Docker', 'Recreate with the known-good configuration. Check readiness, three customer requests, and their fresh logs.');
  await docker(['compose', '-f', 'compose.yaml', 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '60', 'storefront']);
  await reloadApp();
  await dProbe('http://127.0.0.1:8080/readyz');
  for (let i = 1; i <= 3; i++) await dProbe('http://127.0.0.1:8080/api/catalog', 200, `lab-fixed-${i}`, { append: true });
  await sleep(4000);
  await docker(['compose', 'logs', '--no-color', '--tail=20', 'storefront'], { display: (output) => output.split('\n').filter((line) => line.includes('lab-fixed-')).join('\n') });
  await screenshotApp('03-docker-fixed', 200);
  await sleep(7000);

  await chapter('05 / Establish the Kubernetes baseline', 'The image is loaded into kind. Both Pods are ready; a request through the storefront Service succeeds.', 'kubernetes');
  await kubectl(['get', 'pods']);
  await kProbe('catalog', 'http://storefront:8080/api/catalog', 200, 'k8s-baseline', { append: true });
  await sleep(6000);

  await chapter('06 / Diagnose the unready Pod', 'The bad ConfigMap takes effect after replacement. Running with 0/1 ready and zero restarts is a readiness failure.', 'kubernetes');
  await kubectl(['apply', '-f', 'scenarios/k8s.bad-port.yaml']);
  await kubectl(['rollout', 'restart', 'deployment/storefront'], { append: true });
  const failedRollout = await kubectl(['rollout', 'status', 'deployment/storefront', '--timeout=15s'], { allowFailure: true, append: true });
  if (failedRollout.exitCode === 0) throw new Error('Broken rollout unexpectedly succeeded');
  await kubectl(['get', 'pods']);
  await kubectl(['exec', 'deployment/storefront', '--', 'printenv', 'CATALOG_URL'], { append: true });
  await kProbe('storefront', 'http://127.0.0.1:8080/api/catalog', 503, 'k8s-broken', { append: true });
  await kubectl(['logs', 'deployment/storefront', '--tail=30'], { append: true, display: (output) => output.split('\n').filter((line) => line.includes('k8s-broken')).join('\n') });
  await kubectl(['describe', 'pods', '-l', 'app=storefront'], { append: true, display: (output) => output.split('\n').filter((line) => line.includes('Readiness probe failed')).join('\n') });
  await screenshotTerminal('04-kubernetes-broken');
  await sleep(6000);
  await kProbe('storefront', 'http://127.0.0.1:8080/livez', 200);
  await kProbe('storefront', 'http://127.0.0.1:8080/readyz', 503, undefined, { append: true });
  await kProbe('storefront', 'http://catalog:8081/items', 200, undefined, { append: true });
  const unready = await kubectl(['get', 'endpointslices', '-l', 'kubernetes.io/service-name=storefront', '-o', 'jsonpath={.items[0].endpoints[0].conditions.ready}'], { append: true });
  if (unready.output !== 'false') throw new Error('Broken storefront endpoint should be unready');
  await sleep(7000);

  await chapter('07 / Repair and verify Kubernetes', 'Restore the ConfigMap and replace the Pod. Readiness, Service traffic, and fresh request logs now agree.', 'kubernetes');
  await kubectl(['apply', '-f', 'k8s/01-configmap.yaml']);
  await kubectl(['rollout', 'restart', 'deployment/storefront'], { append: true });
  await kubectl(['rollout', 'status', 'deployment/storefront', '--timeout=90s'], { append: true });
  await kubectl(['get', 'pods']);
  await kProbe('storefront', 'http://127.0.0.1:8080/readyz', 200, undefined, { append: true });
  for (let i = 1; i <= 3; i++) await kProbe('catalog', 'http://storefront:8080/api/catalog', 200, `k8s-fixed-${i}`, { append: i === 1 });
  await kubectl(['get', 'pods']);
  await kProbe('catalog', 'http://storefront:8080/api/catalog', 200, 'k8s-fixed-final', { append: true });
  const ready = await kubectl(['get', 'endpointslices', '-l', 'kubernetes.io/service-name=storefront', '-o', 'jsonpath={.items[0].endpoints[0].conditions.ready}'], { append: true });
  if (ready.output !== 'true') throw new Error('Fixed storefront endpoint should be ready');
  await screenshotTerminal('05-kubernetes-fixed');
  await sleep(5000);
  await kubectl(['logs', 'deployment/storefront', '--tail=20'], { display: (output) => output.split('\n').filter((line) => line.includes('k8s-fixed-')).join('\n') });
  await sleep(8000);

  // One responsive smoke check, in an unrecorded browser context.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto('http://127.0.0.1:8080/');
  await mobile.locator('#request:enabled').waitFor();
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile layout overflows horizontally');
  await mobile.screenshot({ path: 'media/screenshots/06-mobile-healthy.png', fullPage: true });
  await mobile.close();

  chapters.at(-1).end = (Date.now() - epoch) / 1000;
  const video = page.video();
  await context.close(); context = undefined; page = undefined;
  await video.saveAs('media/walkthrough.webm');
  await browser.close(); browser = undefined;
  const timestamp = (seconds) => new Date(Math.floor(seconds * 1000)).toISOString().slice(11, 23);
  await writeFile('media/walkthrough.vtt', `WEBVTT\n\n${chapters.map((item, index) => `${index + 1}\n${timestamp(item.start)} --> ${timestamp(item.end)}\n${item.title}\n${item.caption}\n`).join('\n')}`);
  await writeFile('media/evidence/chapters.json', `${JSON.stringify(chapters, null, 2)}\n`);
  await writeFile('media/evidence/session.txt', evidence.map((item) => `${item.startedAt}\n$ ${item.program} ${item.args.join(' ')}\n${item.output}\n[exit ${item.exitCode}]\n`).join('\n'));
  console.log(`Recorded ${Math.round(chapters.at(-1).end)} seconds. Screenshots, video, captions, and raw command evidence saved in media/.`);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
