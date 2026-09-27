import { timingSafeEqual } from 'node:crypto';
import { SupabaseStore } from '../src/store.js';
import { FinanceService } from '../src/service.js';
import { sendTelegram } from '../src/integrations.js';
import { processBotMessage } from '../src/bot.js';

function validSecret(actual) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !actual) return false;
  const first = Buffer.from(String(actual));
  const second = Buffer.from(expected);
  return first.length === second.length && timingSafeEqual(first, second);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!validSecret(req.headers['x-telegram-bot-api-secret-token'])) return res.status(403).json({ ok: false });
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const store = new SupabaseStore();
    await processBotMessage(update?.message, store, new FinanceService(store), sendTelegram);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
}
