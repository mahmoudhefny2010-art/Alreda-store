(() => {
  const container = document.querySelector('[data-admin-order-alerts]');
  if (!container || !window.fetch) return;

  let since = container.dataset.since;
  let polling = false;
  const seen = new Set();

  function show(order) {
    if (!order?.id || seen.has(order.id)) return;
    seen.add(order.id);
    if (seen.size > 100) seen.delete(seen.values().next().value);

    const alert = document.createElement('div');
    alert.className = 'admin-order-toast';
    const link = document.createElement('a');
    link.href = `/admin/orders/${encodeURIComponent(order.id)}`;
    link.className = 'admin-order-toast-link';
    link.textContent = `${container.dataset.message} #${order.order_number}`;
    const action = document.createElement('span');
    action.textContent = container.dataset.view;
    link.append(action);
    alert.append(link);
    container.append(alert);
    window.setTimeout(() => alert.remove(), 12000);
  }

  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const response = await fetch(`/api/admin/orders/updates?since=${encodeURIComponent(since)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!Array.isArray(payload.orders)) return;
      for (const order of payload.orders) show(order);
      if (payload.orders.length) since = payload.orders[payload.orders.length - 1].created_at;
    } catch {
      // Keep the admin page usable if the database or network is temporarily unavailable.
    } finally {
      polling = false;
    }
  }

  poll();
  window.setInterval(poll, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
