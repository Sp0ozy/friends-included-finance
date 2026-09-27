import { FinanceService } from '../src/service.js';
import { SupabaseStore } from '../src/store.js';
import { UserError } from '../src/domain.js';

export async function handleRequest(method, query, body) {
  const service = new FinanceService(new SupabaseStore());
  if (method === 'GET' && query.action === 'health') return {
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    sheets: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SPREADSHEET_ID),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET)
  };
  if (method === 'GET' && query.action === 'config') return {
    botUrl: process.env.PUBLIC_BOT_URL ?? '',
    sheetUrl: process.env.PUBLIC_SHEET_URL ?? 'https://docs.google.com/spreadsheets/d/1_h3iKcl-JJujSPhhNleP45wIoFm6KgNgLMKngw0vK3k/edit',
    repoUrl: process.env.PUBLIC_REPO_URL ?? 'https://github.com/Sp0ozy/friends-included-finance'
  };
  if (method === 'GET' && query.action === 'state') return service.state(query.role);
  if (method !== 'POST') throw new UserError('Unsupported request.', 405);
  const role = body?.role;
  switch (body?.action) {
    case 'sale': return service.submitSale(body, { employee: role, source: 'website' });
    case 'expense': return service.submitExpense(body, { employee: role, source: 'website' });
    case 'approveSale': return service.approveSale(body.ref, body.split, role);
    case 'approveExpense': return service.approveExpense(body.ref, body.allocation, role);
    case 'retry': return service.retry(body.ref, body.target, role);
    case 'linkTelegram': return service.linkTelegram(body.userId, body.employee, role);
    default: throw new UserError('Unknown action.');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const query = req.query ?? Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const data = await handleRequest(req.method, query, body);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    const status = error instanceof UserError ? error.status : 500;
    res.status(status).json({ ok: false, error: error instanceof UserError ? error.message : 'Server error. Check the server logs and integration settings.' });
    if (!(error instanceof UserError)) console.error(error);
  }
}
