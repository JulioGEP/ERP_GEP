import { httpGet, httpPost } from './http.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function toast(message, kind = 'danger', timeout = 4200) {
  const box = el(
    'div',
    {
      class: `position-fixed bottom-0 end-0 m-3 alert alert-${kind}`,
      role: 'alert',
      style: 'z-index:1080;',
    },
    message,
  );
  document.body.appendChild(box);
  setTimeout(() => box.remove(), timeout);
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

  const rows = deals.map((row) => {
    const hasDealId = row?.deal_id != null && row.deal_id !== '';
    const dealId = hasDealId ? String(row.deal_id) : null;
    const fallbackTitle = hasDealId ? `Presupuesto #${dealId}` : 'Presupuesto';
    const title = (row?.title && String(row.title).trim()) || fallbackTitle;
    const client = row?.org_name || row?.org_id || '—';

    return el('tr', {}, [
      el('td', {}, title),
      el('td', {}, client),
      el('td', {}, '—'),
      el('td', {}, '—'),
    ]);
  });

  const table = el('table', { class: 'table table-hover align-middle mb-0' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Presupuesto'),
      el('th', {}, 'Cliente'),
      el('th', {}, 'Sede'),
      el('th', {}, 'Producto'),
    ])),
    el('tbody', {}, rows),
  ]);

  const card = el('div', { class: 'card shadow-sm' }, el('div', { class: 'card-body p-0' }, table));
  container.appendChild(card);
}

async function loadDeals() {
  const container = document.getElementById('budgets-root');
  if (!container) return;

  const result = await httpGet('/.netlify/functions/deals');
  if (!result.ok) {
    console.error('[Presupuestos] loadDeals error', result);
    toast(`[${result.error_code}] ${result.message}`, 'danger');
    renderEmpty(container);
    return;
  }

  const deals = Array.isArray(result.data?.deals) ? result.data.deals : [];
  if (deals.length === 0) {
    renderEmpty(container);
    return;
  }

  renderTable(container, deals);
}

async function importDeal() {
  const input = document.getElementById('importDealId');
  const modalEl = document.getElementById('importModal');
  const dealId = (input?.value || '').trim();

  if (!dealId) {
    toast('Introduce un ID de presupuesto', 'warning');
    input?.focus();
    return;
  }

  const result = await httpPost('/.netlify/functions/deals_import', { dealId });

  if (!result.ok) {
    console.error('[Presupuestos] import error', result);
    toast(`[${result.error_code}] ${result.message}`, 'danger');
    return;
  }

  if (modalEl && window.bootstrap?.Modal) {
    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();
  }

  toast('Presupuesto importado correctamente', 'success');
  if (input) input.value = '';
  await loadDeals();
}

function wireUI() {
  const refreshBtn = document.getElementById('btnRefresh');
  const openImportBtn = document.getElementById('btnOpenImportModal');
  const confirmImportBtn = document.getElementById('btnConfirmImport');
  const input = document.getElementById('importDealId');

  refreshBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    loadDeals();
  });

  openImportBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    const modalEl = document.getElementById('importModal');
    if (modalEl && window.bootstrap?.Modal) {
      const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
      setTimeout(() => input?.focus(), 150);
    }
  });

  confirmImportBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    importDeal();
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      importDeal();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireUI();
  loadDeals();
});

export { loadDeals, importDeal, wireUI };
