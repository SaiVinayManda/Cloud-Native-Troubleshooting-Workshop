const byId = (id) => document.getElementById(id);
const button = byId('request');
async function load() {
  button.disabled = true;
  try {
    const response = await fetch('/api/catalog');
    const payload = await response.json();
    byId('status').textContent = response.ok ? 'HEALTHY' : 'UNAVAILABLE';
    byId('status').className = `pill ${response.ok ? 'ok' : 'bad'}`;
    byId('http').textContent = `HTTP ${response.status}`;
    byId('http').className = `http ${response.ok ? '' : 'bad'}`;
    byId('payload').textContent = JSON.stringify(payload, null, 2);
    byId('request-id').textContent = payload.requestId;
    const container = byId('products');
    container.replaceChildren();
    if (response.ok) {
      for (const [index, product] of payload.products.entries()) {
        const row = document.createElement('div');
        row.className = 'product';
        const icon = document.createElement('span');
        icon.className = 'icon'; icon.textContent = ['◡', '▤', '◇'][index % 3];
        const name = document.createElement('strong'); name.textContent = product.name;
        const price = document.createElement('span'); price.className = 'price'; price.textContent = `$${product.price.toFixed(2)}`;
        row.append(icon, name, price); container.append(row);
      }
    } else {
      const message = document.createElement('div'); message.className = 'error-message';
      const title = document.createElement('strong'); title.textContent = 'The catalog is out of reach.';
      const detail = document.createElement('p'); detail.textContent = 'The web process is still running. Use this request ID to find the failed dependency in the logs.';
      message.append(title, detail); container.append(message);
    }
  } catch {
    byId('status').textContent = 'NETWORK ERROR'; byId('status').className = 'pill bad';
    byId('http').textContent = 'NO RESPONSE'; byId('http').className = 'http bad';
    byId('payload').textContent = 'Could not contact the storefront. Check that the server and port mapping are running.';
    byId('request-id').textContent = '—'; byId('products').replaceChildren();
  } finally { button.disabled = false; }
}
button.addEventListener('click', load);
load();
