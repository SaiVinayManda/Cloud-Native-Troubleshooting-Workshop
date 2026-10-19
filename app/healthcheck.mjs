try {
  const port = process.env.PORT || (process.env.APP_ROLE === 'catalog' ? 8081 : 8080);
  const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(2000) });
  console.log(`readiness HTTP ${response.status}`);
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  console.error(error.cause?.code || error.name);
  process.exitCode = 1;
}
