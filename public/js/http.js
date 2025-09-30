export async function httpGet(path) {
  return request(path, { method: 'GET' });
}

export async function httpPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

async function request(path, options) {
  try {
    const response = await fetch(path, options);
    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    if (response.ok && (!data || data.ok !== false)) {
      return { ok: true, data };
    }

    const errorCode = data?.error_code || 'UNEXPECTED_ERROR';
    const message = data?.message || response.statusText || 'Error inesperado';

    return {
      ok: false,
      data,
      error_code: errorCode,
      message,
    };
  } catch (err) {
    return {
      ok: false,
      error_code: 'NETWORK_ERROR',
      message: err?.message || 'Fallo de red',
    };
  }
}
