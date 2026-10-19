// Portable curl alternative, available inside both containers.
const [url, expected = '200', requestId] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node app/probe.mjs URL [expected-status=200] [request-id]');
  process.exit(2);
}
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: requestId ? { 'x-request-id': requestId } : {}
  });
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
  if (response.status !== Number(expected)) process.exitCode = 1;
} catch (error) {
  console.error(`Request failed: ${error.cause?.code || error.name}`);
  process.exitCode = 1;
}
