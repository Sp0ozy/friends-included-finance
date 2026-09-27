import { UserError } from './domain.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new UserError('Supabase is not configured on the server.', 503);
  return { url: url.replace(/\/$/, ''), key };
}

async function request(table, method = 'GET', query = {}, body = null, extraHeaders = {}) {
  const { url, key } = config();
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(query)) endpoint.searchParams.set(name, value);
  const headers = { apikey: key, Accept: 'application/json', ...extraHeaders };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(endpoint, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 409 || detail.includes('23505')) throw new UserError('That reference already exists.', 409);
    throw new Error(`Supabase ${table} ${method} failed (${response.status}): ${detail.slice(0, 400)}`);
  }
  if (response.status === 204) return [];
  return response.json();
}

export class SupabaseStore {
  async listTransactions(employee = null) {
    return request('transactions', 'GET', { select: '*', ...(employee ? { submitted_by: `eq.${employee}` } : {}), order: 'submitted_at.asc' });
  }

  async getTransaction(ref) {
    const rows = await request('transactions', 'GET', { select: '*', ref: `eq.${ref}`, limit: '1' });
    return rows[0] ?? null;
  }

  async insertTransaction(record) {
    const rows = await request('transactions', 'POST', { select: '*' }, record, { Prefer: 'return=representation' });
    return rows[0];
  }

  async updateTransaction(ref, changes, filters = {}) {
    const conditions = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, `eq.${value}`]));
    const rows = await request('transactions', 'PATCH', { select: '*', ref: `eq.${ref}`, ...conditions }, changes, { Prefer: 'return=representation' });
    return rows[0] ?? null;
  }

  async saveVisitor(userId, chatId, name) {
    const rows = await request('telegram_visitors', 'POST', { on_conflict: 'telegram_user_id', select: '*' }, {
      telegram_user_id: String(userId), chat_id: String(chatId), display_name: String(name ?? ''), seen_at: new Date().toISOString()
    }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    return rows[0];
  }

  async listVisitors() {
    return request('telegram_visitors', 'GET', { select: '*', order: 'seen_at.desc' });
  }

  async getVisitor(userId) {
    const rows = await request('telegram_visitors', 'GET', { select: '*', telegram_user_id: `eq.${userId}`, limit: '1' });
    return rows[0] ?? null;
  }

  async getLink(userId) {
    const rows = await request('telegram_links', 'GET', { select: '*', telegram_user_id: `eq.${userId}`, limit: '1' });
    return rows[0] ?? null;
  }

  async getEmployeeLink(employee) {
    const rows = await request('telegram_links', 'GET', { select: '*', employee_slug: `eq.${employee}`, order: 'updated_at.desc', limit: '1' });
    return rows[0] ?? null;
  }

  async listLinks() {
    return request('telegram_links', 'GET', { select: '*', order: 'updated_at.desc' });
  }

  async setLink(userId, employee, chatId) {
    const rows = await request('telegram_links', 'POST', { on_conflict: 'telegram_user_id', select: '*' }, {
      telegram_user_id: String(userId), employee_slug: employee, chat_id: String(chatId), updated_at: new Date().toISOString()
    }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    return rows[0];
  }
}
