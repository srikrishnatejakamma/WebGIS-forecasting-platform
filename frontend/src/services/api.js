export async function api(path, options = {}, token = '') {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('X-API-Token', token);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join(', ') : body.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}
