import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';

// Serve only media/ on loopback; supports byte ranges for video seeking.
const root = resolve('media');
const videoPath = resolve(process.env.VERIFY_VIDEO || resolve(root, 'walkthrough.webm'));
const types = { '.html': 'text/html', '.webm': 'video/webm', '.vtt': 'text/vtt', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  try {
    const requestedPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = requestedPath === '/walkthrough.webm' ? videoPath : resolve(root, `.${requestedPath}`);
    if (requestedPath !== '/walkthrough.webm' && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const file = await stat(path);
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
    if (start > end || start >= file.size) { response.writeHead(416).end(); return; }
    response.writeHead(range ? 206 : 200, {
      'content-type': types[extname(path)] || 'text/plain', 'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      ...(range ? { 'content-range': `bytes ${start}-${end}/${file.size}` } : {})
    });
    createReadStream(path, { start, end }).pipe(response);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/walkthrough.html`);
  await page.waitForFunction(() => Number.isFinite(document.querySelector('video').duration));
  const metadata = await page.locator('video').evaluate((video) => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, error: video.error?.message }));
  assert.equal(metadata.width, 1600); assert.equal(metadata.height, 1000);
  assert.ok(metadata.duration > 90 && metadata.duration < 180); assert.equal(metadata.error, undefined);
  await page.locator('track').evaluate((track) => { track.track.mode = 'hidden'; });
  await page.waitForFunction(() => document.querySelector('track').track.cues?.length === 7);
  await mkdir('artifacts/media-qa', { recursive: true });
  const seek = (time) => page.locator('video').evaluate((video, time) => new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return; }
    video.addEventListener('seeked', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('video decode failed')), { once: true });
    video.currentTime = time;
  }), time);
  if (process.argv.includes('--sync-captions')) {
    // Encoder timing can differ slightly from the capture script's wall clock.
    // Compare the recorded title pixels to find each actual chapter transition.
    const chapters = JSON.parse(await readFile('media/evidence/chapters.json', 'utf8'));
    const signature = () => page.locator('video').evaluate((video) => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 16;
      const context = canvas.getContext('2d'); context.drawImage(video, 40, 105, 1200, 60, 0, 0, 240, 16);
      return Array.from(context.getImageData(0, 0, 240, 16).data);
    });
    const referenceTimes = chapters.map((chapter) => chapter.end - 1);
    const references = [];
    for (const time of referenceTimes) { await seek(time); references.push(await signature()); }
    const distance = (left, right) => left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
    const starts = [0];
    for (let index = 1; index < chapters.length; index++) {
      let low = referenceTimes[index - 1], high = referenceTimes[index];
      while (high - low > 0.08) {
        const mid = (low + high) / 2; await seek(mid); const pixels = await signature();
        if (distance(pixels, references[index - 1]) < distance(pixels, references[index])) low = mid;
        else high = mid;
      }
      starts.push(Number(high.toFixed(3)));
    }
    for (const [index, chapter] of chapters.entries()) {
      chapter.videoStart = starts[index]; chapter.videoEnd = starts[index + 1] ?? metadata.duration;
    }
    const timestamp = (seconds) => new Date(Math.floor(seconds * 1000)).toISOString().slice(11, 23);
    await writeFile('media/walkthrough.vtt', `WEBVTT\n\n${chapters.map((chapter, index) => `${index + 1}\n${timestamp(chapter.videoStart)} --> ${timestamp(chapter.videoEnd)}\n${chapter.title}\n${chapter.caption}\n`).join('\n')}`);
    await writeFile('media/evidence/chapters.json', `${JSON.stringify(chapters, null, 2)}\n`);
    console.log(`Synchronized captions to recorded chapter transitions: ${starts.join(', ')} seconds.`);
  }
  const times = [5, 12, 23, 42, 56, 78, Math.floor(metadata.duration - 6)];
  for (const time of times) {
    await seek(time);
    const dataUrl = await page.locator('video').evaluate((video) => {
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0); return canvas.toDataURL('image/png');
    });
    await writeFile(`artifacts/media-qa/frame-${time}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  const result = { ...metadata, captionCues: 7, decodedFramesAtSeconds: times };
  await writeFile('artifacts/media-qa/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
