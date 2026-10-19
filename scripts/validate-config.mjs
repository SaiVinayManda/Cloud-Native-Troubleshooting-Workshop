import { readFile, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseAllDocuments } from 'yaml';

const files = ['compose.yaml', 'scenarios/compose.bad-port.yaml', 'scenarios/k8s.bad-port.yaml', ...(await readdir('k8s')).filter((file) => file.endsWith('.yaml')).map((file) => `k8s/${file}`)];
const configurations = new Map();
for (const file of files) {
  const documents = parseAllDocuments(await readFile(file, 'utf8'), { uniqueKeys: true });
  for (const doc of documents) assert.deepEqual(doc.errors, [], `${file}: invalid YAML`);
  configurations.set(file, documents.map((doc) => doc.toJS()));
}
const [compose] = configurations.get('compose.yaml');
assert.equal(compose.services.storefront.environment.CATALOG_URL, 'http://catalog:8081');
assert.equal(configurations.get('scenarios/compose.bad-port.yaml')[0].services.storefront.environment.CATALOG_URL, 'http://catalog:9090');
const resources = [...configurations].filter(([file]) => file.startsWith('k8s/')).flatMap(([, docs]) => docs);
const catalog = resources.find((resource) => resource.kind === 'Service' && resource.metadata.name === 'catalog');
assert.equal(catalog.spec.ports[0].port, 8081);
for (const resource of resources.filter((resource) => resource.kind === 'Deployment')) {
  const container = resource.spec.template.spec.containers[0];
  assert.equal(container.image, 'troubleshooting-storefront:1.0');
  assert.equal(container.imagePullPolicy, 'Never');
  assert.equal(container.readinessProbe.httpGet.path, '/readyz');
  assert.equal(container.livenessProbe.httpGet.path, '/livez');
}
// Check local Markdown links and embedded media after documentation has been written.
for (const file of ['README.md', ...(await readdir('docs')).filter((file) => file.endsWith('.md')).map((file) => `docs/${file}`)]) {
  const markdown = await readFile(file, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await access(new URL(target, new URL(file, `file://${process.cwd().replaceAll('\\', '/')}/`)));
  }
}
console.log(`Validated ${files.length} YAML files, probe wiring, fault configuration, and Markdown/media links.`);
