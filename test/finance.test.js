import test from 'node:test';
import assert from 'node:assert/strict';
import { commissions, totals, UserError } from '../src/domain.js';
import { FinanceService } from '../src/service.js';
import { processBotMessage } from '../src/bot.js';

class MemoryStore {
  constructor() { this.rows = new Map(); this.visitors = new Map(); this.links = new Map(); }
  async listTransactions(employee = null) { return [...this.rows.values()].filter(row => !employee || row.submitted_by === employee).map(row => structuredClone(row)); }
  async getTransaction(ref) { return structuredClone(this.rows.get(ref) ?? null); }
  async insertTransaction(row) {
    if (this.rows.has(row.ref)) throw new UserError('That reference already exists.', 409);
    const sheet_row = [...this.rows.values()].filter(existing => existing.kind === row.kind).length + 2;
    const saved = { ...structuredClone(row), sheet_row, submitted_at: new Date().toISOString(), revision: 1, sheets_state: 'pending', sheets_error: null };
    this.rows.set(row.ref, saved); return structuredClone(saved);
  }
  async updateTransaction(ref, changes, filters = {}) {
    const row = this.rows.get(ref); if (!row) return null;
    if (Object.entries(filters).some(([key, value]) => String(row[key]) !== String(value))) return null;
    Object.assign(row, structuredClone(changes)); return structuredClone(row);
  }
  async saveVisitor(userId, chatId, displayName) { const row = { telegram_user_id: String(userId), chat_id: String(chatId), display_name: displayName }; this.visitors.set(String(userId), row); return row; }
  async getVisitor(userId) { return this.visitors.get(String(userId)) ?? null; }
  async listVisitors() { return [...this.visitors.values()]; }
  async getLink(userId) { return this.links.get(String(userId)) ?? null; }
  async getEmployeeLink(employee) { return [...this.links.values()].filter(link => link.employee_slug === employee).at(-1) ?? null; }
  async listLinks() { return [...this.links.values()]; }
  async setLink(userId, employee, chatId) { const row = { telegram_user_id: String(userId), employee_slug: employee, chat_id: String(chatId) }; this.links.set(String(userId), row); return row; }
}

function harness() {
  const store = new MemoryStore();
  const sheets = new Map(); const telegram = []; const confirmations = [];
  const control = { failSheets: false, failTelegram: false };
  const service = new FinanceService(store, {
    syncToSheets: async record => { if (control.failSheets) throw new Error('Sheets interrupted'); sheets.set(record.ref, structuredClone(record)); },
    sendTelegram: async (chatId, message) => { if (control.failTelegram) throw new Error('Telegram interrupted'); telegram.push({ chatId, message }); }
  });
  const botSend = async (chatId, message) => { confirmations.push({ chatId, message }); };
  const bot = async (content, userId = 123, chatId = 456) => processBotMessage({ chat: { id: chatId, type: 'private' }, from: { id: userId, first_name: 'Tester' }, text: content }, store, service, botSend);
  return { store, sheets, telegram, confirmations, control, service, bot };
}

test('commission rounding assigns residual to largest share with fixed tie order', () => {
  assert.deepEqual(commissions(5, { richard: 34, anastasia: 33, jeanclaude: 33 }), { pool: 1, earned: { richard: 1, anastasia: 0, jeanclaude: 0 } });
  assert.deepEqual(commissions(25, { richard: 50, anastasia: 50, jeanclaude: 0 }), { pool: 3, earned: { richard: 1, anastasia: 2, jeanclaude: 0 } });
});

test('both prescribed test rounds, bot role relink, approvals, and controls', async () => {
  const h = harness();
  await h.bot('/start');
  await h.service.linkTelegram('123', 'richard', 'svetlana');
  await h.bot('/sale S01 | Olivia Rose | A | One proud uncle and an emotional grandmother | 1000 | 50/30/20');
  await h.service.linkTelegram('123', 'kevin', 'svetlana');
  await h.bot('/expense E01 | Rented suit and fake pearl necklace for the relatives | Materials | 120 | A');
  assert.equal((await h.store.getTransaction('S01')).submitted_by, 'richard');
  assert.equal((await h.store.getTransaction('S01')).origin_chat_id, '456');
  await h.service.submitSale({ ref: 'S02', customer: 'Daniel King', project: 'B', description: 'University friends, dancing, and the stripping performance', amount: '2000', split: { richard: 0, anastasia: 50, jeanclaude: 50 } }, { employee: 'anastasia', source: 'website' });
  await h.service.submitExpense({ ref: 'E02', description: 'Taxi for the grandmother; Kevin selected the wrong project', category: 'Travel', amount: '80', allocation: 'B' }, { employee: 'kevin', source: 'website' });
  await h.service.submitExpense({ ref: 'E03', description: 'Monthly company website subscription', category: 'Other', amount: '100', allocation: 'overhead' }, { employee: 'kevin', source: 'website' });
  assert.equal(totals(await h.store.listTransactions()).company.result, -30000);
  await h.service.approveSale('S01', null, 'svetlana');
  await h.service.approveSale('S02', { richard: 20, anastasia: 40, jeanclaude: 40 }, 'svetlana');
  await h.service.approveExpense('E01', 'A', 'svetlana');
  await h.service.approveExpense('E02', 'A', 'svetlana');
  let summary = totals(await h.store.listTransactions());
  assert.equal(summary.projects.A.result, 70000);
  assert.equal(summary.projects.B.result, 180000);
  assert.equal(summary.company.result, 240000);
  assert.deepEqual(summary.people, { richard: 9000, anastasia: 11000, jeanclaude: 10000 });
  assert.equal(h.telegram.filter(item => item.chatId === '456').length, 3);
  assert.ok(h.telegram.some(item => item.message.includes('S01')));
  assert.ok(h.telegram.some(item => item.message.includes('E01')));
  assert.equal(h.sheets.get('S02').final_split.richard, 20);
  assert.equal(h.sheets.get('E02').final_allocation, 'A');

  await h.service.submitSale({ ref: 'S03', customer: 'Emma Stonebridge', project: 'A', description: 'Premium relatives, including an uncle presented as a surgeon', amount: '1500', split: { richard: 40, anastasia: 40, jeanclaude: 20 } }, { employee: 'jeanclaude', source: 'website' });
  await h.service.submitSale({ ref: 'S04', customer: 'Lucas Green', project: 'B', description: 'Small group of loud university friends', amount: '800', split: { richard: 25, anastasia: 25, jeanclaude: 50 } }, { employee: 'richard', source: 'website' });
  await h.service.submitSale({ ref: 'S05', customer: 'Mia Brooks', project: 'B', description: 'Extra guests and an embarrassing speech', amount: '600', split: { richard: 100, anastasia: 0, jeanclaude: 0 } }, { employee: 'richard', source: 'website' });
  await h.service.submitExpense({ ref: 'E04', description: 'Replacement costumes after an enthusiastic dance performance', category: 'Materials', amount: '250', allocation: 'B' }, { employee: 'kevin', source: 'website' });
  await h.service.submitExpense({ ref: 'E05', description: 'Minibus for university friends; Kevin selected the wrong project again', category: 'Travel', amount: '90', allocation: 'A' }, { employee: 'kevin', source: 'website' });
  await h.service.submitExpense({ ref: 'E06', description: 'Company telephone subscription', category: 'Other', amount: '60', allocation: 'overhead' }, { employee: 'kevin', source: 'website' });
  await h.service.submitExpense({ ref: 'E07', description: 'Emergency replacement clothing; project allocation still needs checking', category: 'Materials', amount: '140', allocation: 'A' }, { employee: 'kevin', source: 'website' });
  await h.service.linkTelegram('123', 'jeanclaude', 'svetlana');
  await h.service.approveSale('S03', { richard: 20, anastasia: 30, jeanclaude: 50 }, 'svetlana');
  await h.service.approveSale('S04', null, 'svetlana');
  await h.service.linkTelegram('123', 'kevin', 'svetlana');
  await h.service.approveExpense('E04', 'B', 'svetlana');
  await h.service.approveExpense('E05', 'B', 'svetlana');
  summary = totals(await h.store.listTransactions());
  assert.deepEqual(summary.projects.A, { income: 250000, commissions: 25000, expenses: 20000, result: 205000 });
  assert.deepEqual(summary.projects.B, { income: 280000, commissions: 28000, expenses: 34000, result: 218000 });
  assert.equal(summary.company.result, 393000);
  assert.equal(summary.company.overhead, 16000);
  assert.equal(summary.company.awaiting, 14000);
  assert.deepEqual(summary.people, { richard: 14000, anastasia: 17500, jeanclaude: 21500 });
  assert.equal((await h.store.getTransaction('S05')).status, 'pending');
  assert.equal((await h.store.getTransaction('E07')).status, 'awaiting_allocation');
  assert.match(h.telegram.find(item => item.message.includes('S03')).message, /split changed/);
  assert.match(h.telegram.find(item => item.message.includes('E05')).message, /allocation changed/);
  assert.equal(h.telegram.some(item => item.message.includes('S05') || item.message.includes('E07')), false);
  assert.equal(h.sheets.size, 12);
  assert.deepEqual((await h.service.state('richard')).records.map(row => row.ref), ['S01', 'S04', 'S05']);
  assert.equal((await h.service.state('kevin')).records.length, 7);
  assert.equal((await h.service.state('svetlana')).records.length, 12);
  assert.equal((await h.service.approveSale('S03', null, 'svetlana')).status, 'approved');
  assert.equal(totals(await h.store.listTransactions()).company.result, 393000);
  await assert.rejects(() => h.service.approveSale('S05', null, 'richard'), /Only a manager/);
  await assert.rejects(() => h.service.submitSale({ ref: 'S06' }, { employee: 'kevin', source: 'website' }), /Only a sales/);
  await assert.rejects(() => h.service.submitExpense({ ref: 'E08', description: 'Zero', amount: '0', category: 'Other', allocation: 'A' }, { employee: 'kevin', source: 'website' }), /greater than zero/);
  await assert.rejects(() => h.service.submitSale({ ref: 'S06', customer: 'Test', project: 'A', description: 'Test', amount: '100', split: { richard: 60, anastasia: 30, jeanclaude: 20 } }, { employee: 'richard', source: 'website' }), /add to 100/);
  await assert.rejects(() => h.service.submitSale({ ref: 'S01', customer: 'Test', project: 'A', description: 'Test', amount: '100', split: { richard: 100, anastasia: 0, jeanclaude: 0 } }, { employee: 'richard', source: 'website' }), /already exists/);
  assert.equal(totals(await h.store.listTransactions()).company.result, 393000);
});

test('failed Sheets and Telegram delivery stay visible and retry without duplicate finance', async () => {
  const h = harness();
  h.control.failSheets = true;
  await h.service.submitSale({ ref: 'S10', customer: 'Test', project: 'A', description: 'Test sale', amount: '10', split: { richard: 100, anastasia: 0, jeanclaude: 0 } }, { employee: 'richard', source: 'website' });
  assert.equal((await h.store.getTransaction('S10')).sheets_state, 'failed');
  assert.equal(h.sheets.size, 0);
  h.control.failSheets = false;
  await h.service.retry('S10', 'sheets', 'svetlana');
  assert.equal(h.sheets.size, 1);
  await h.store.saveVisitor('1', '2', 'Test');
  await h.service.linkTelegram('1', 'richard', 'svetlana');
  h.control.failTelegram = true;
  await h.service.approveSale('S10', null, 'svetlana');
  assert.equal((await h.store.getTransaction('S10')).notification_state, 'failed');
  h.control.failTelegram = false;
  await h.service.retry('S10', 'telegram', 'svetlana');
  assert.equal((await h.store.getTransaction('S10')).notification_state, 'sent');
  assert.equal(h.telegram.length, 1);
  assert.equal(h.sheets.size, 1);
  assert.equal(totals(await h.store.listTransactions()).company.result, 900);
});
