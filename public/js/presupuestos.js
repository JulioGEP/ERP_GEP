// public/js/presupuestos.js
// Render de TODOS los deals + refresco tras importar.
// Funciona con los IDs definidos en public/presupuestos.html

const API_BASE = ''; // relativo al host actual

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `GET ${path} failed`);
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `POST ${path} failed`);
  }
  return data;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(ch => {
    if (ch == null) return;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  });
  return node;
}

function toast(msg, kind = 'danger', ms = 4200) {
  const box = el('div', {
    class: `position-fixed bottom-0 end-0 m-3 alert alert-${kind}`,
    role: 'alert',
    style: 'z-index:1080;'
  }, msg);
  document.body.appendChild(box);
  setTimeout(() => box.remove(), ms);
}

function renderEmpty(container) {
  container.innerHTML = '';
  const card = el('div', { class: 'card shadow-sm' }, [
    el('div', { class: 'card-body text-center text-muted' }, [
      el('h6', { class: 'mb-1 fw-semibold' }, 'No hay presupuestos sin sesiones pendientes.'),
      el('div', { class: 'small' }, 'Importa un presupuesto para comenzar a planificar la formación.'),
    ]),
  ]);
  container.appendChild(card);
}

function renderTable(container, deals) {
  container.innerHTML = '';
  const table = el('table', { class: 'table table-hover align-middle mb-0', id: 'budgets-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'ID'),
      el('th', {}, 'Título'),
      el('th', {}, 'Organización'),
    ])),
    el('tbody', {}, deals.map(d =>
      el('tr', {}, [
        el('td', {}, String(d.deal_id ?? '—')),
        el('td', {}, String(d.title ?? '—')),
        el('td', {}, String(d.org_name ?? d.org_id ?? '—')),
      ])
    )),
  ]);
  const card = el('div', { class: 'card shadow-sm' }, el('div', { class: 'card-body p-0' }, table));
  container.appendChild(card);
}

async function loadDeals() {
  const container = document.getElementById('budgets-root');
  if (!container) return;
  try {
    const data = await apiGet('/.netlify/functions/deals');
    const deals = Array.isArray(data.deals) ? data.deals : [];
    if (deals.length === 0) renderEmpty(container);
    else renderTable(container, deals);
  } catch (err) {
    renderEmpty(container);
    console.error('[Presupuestos] loadDeals error', err);
    toast(`Error cargando presupuestos: ${err.message}`);
  }
}

async function importDeal() {
  const input = document.getElementById('importDealId');
  const modalEl = document.getElementById('importModal');
  const dealId = (input?.value || '').trim();
  if (!dealId) {
    toast('Introduce un ID de presupuesto', 'warning');
    return;
  }
  try {
    await apiPost('/.netlify/functions/deals_import', { dealId });
    toast('Presupuesto importado correctamente', 'success');
    // Cierra modal si existe (Bootstrap)
    if (modalEl && window.bootstrap && window.bootstrap.Modal) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.hide();
    }
    await loadDeals();
  } catch (err) {
    console.error('[Presupuestos] import error', err);
    toast(`No se pudo importar: ${err.message}`, 'danger');
  }
}

function wireUI() {
  const refreshBtn = document.getElementById('btnRefresh');
  const importOpenBtn = document.getElementById('btnOpenImportModal');
  const importConfirmBtn = document.getElementById('btnConfirmImport');

  refreshBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    loadDeals();
  });

  importOpenBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const modalEl = document.getElementById('importModal');
    if (modalEl && window.bootstrap && window.bootstrap.Modal) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
      // Foco al input
      setTimeout(() => document.getElementById('importDealId')?.focus(), 150);
    }
  });

  importConfirmBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    importDeal();
  });

  // ENTER en el input ⇒ importar
  document.getElementById('importDealId')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      importDeal();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireUI();
  loadDeals();
});
