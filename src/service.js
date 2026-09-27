import { ALLOCATIONS, EMPLOYEES, UserError, commissions, reference, requireRole, totals, validateExpense, validateSale, validateSplit } from './domain.js';
import { decisionMessage, sendTelegram, syncToSheets } from './integrations.js';

export class FinanceService {
  constructor(store, integrations = { syncToSheets, sendTelegram }) {
    this.store = store;
    this.integrations = integrations;
  }

  async state(actor) {
    if (!EMPLOYEES[actor]) throw new UserError('Choose a demonstration role.', 403);
    const manager = actor === 'svetlana';
    const records = await this.store.listTransactions(manager ? null : actor);
    return {
      role: actor, records,
      ...(manager ? {
        totals: totals(records),
        visitors: await this.store.listVisitors(),
        links: await this.store.listLinks()
      } : {})
    };
  }

  async submitSale(input, actor) {
    const record = validateSale({ ...input, source: actor.source, origin_chat_id: actor.chatId ?? null }, actor.employee);
    const saved = await this.store.insertTransaction(record);
    await this.sync(saved.ref);
    return this.store.getTransaction(saved.ref);
  }

  async submitExpense(input, actor) {
    const record = validateExpense({ ...input, source: actor.source, origin_chat_id: actor.chatId ?? null }, actor.employee);
    const saved = await this.store.insertTransaction(record);
    await this.sync(saved.ref);
    return this.store.getTransaction(saved.ref);
  }

  async approveSale(refValue, splitValue, actor) {
    requireRole(actor, 'manager');
    const ref = reference(refValue);
    const existing = await this.store.getTransaction(ref);
    if (!existing || existing.kind !== 'sale') throw new UserError('Sale not found.', 404);
    if (existing.status === 'approved') return existing;
    const finalSplit = validateSplit(splitValue ?? existing.proposed_split);
    const { earned } = commissions(existing.amount_cents, finalSplit);
    const chatId = await this.notificationDestination(existing);
    const saved = await this.store.updateTransaction(ref, {
      final_split: finalSplit, commission_cents: earned, status: 'approved', revision: existing.revision + 1,
      decided_at: new Date().toISOString(), sheets_state: 'pending', sheets_error: null,
      notification_chat_id: chatId, notification_state: chatId ? 'pending' : 'no_recipient', notification_error: null
    }, { status: 'pending' });
    if (!saved) return this.store.getTransaction(ref);
    await this.sync(ref);
    await this.notify(ref);
    return this.store.getTransaction(ref);
  }

  async approveExpense(refValue, allocation, actor) {
    requireRole(actor, 'manager');
    const ref = reference(refValue);
    const existing = await this.store.getTransaction(ref);
    if (!existing || existing.kind !== 'expense') throw new UserError('Expense not found.', 404);
    if (existing.status === 'allocated') return existing;
    if (!ALLOCATIONS[allocation]) throw new UserError('Choose A, B, or Company overhead.');
    const chatId = await this.notificationDestination(existing);
    const saved = await this.store.updateTransaction(ref, {
      final_allocation: allocation, status: 'allocated', revision: existing.revision + 1,
      decided_at: new Date().toISOString(), sheets_state: 'pending', sheets_error: null,
      notification_chat_id: chatId, notification_state: chatId ? 'pending' : 'no_recipient', notification_error: null
    }, { status: 'awaiting_allocation' });
    if (!saved) return this.store.getTransaction(ref);
    await this.sync(ref);
    await this.notify(ref);
    return this.store.getTransaction(ref);
  }

  async notificationDestination(record) {
    if (record.origin_chat_id) return record.origin_chat_id;
    const linked = await this.store.getEmployeeLink(record.submitted_by);
    return linked?.chat_id ?? null;
  }

  async sync(refValue) {
    const ref = reference(refValue);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const record = await this.store.getTransaction(ref);
      if (!record) throw new UserError('Transaction not found.', 404);
      await this.store.updateTransaction(ref, { sheets_state: 'syncing', sheets_error: null });
      try {
        await this.integrations.syncToSheets(record);
      } catch (error) {
        await this.store.updateTransaction(ref, { sheets_state: 'failed', sheets_error: String(error.message ?? error).slice(0, 300) }, { revision: record.revision });
        return this.store.getTransaction(ref);
      }
      const current = await this.store.getTransaction(ref);
      if (current.revision !== record.revision) continue;
      await this.store.updateTransaction(ref, { sheets_state: 'synced', sheets_error: null }, { revision: record.revision });
      return this.store.getTransaction(ref);
    }
    await this.store.updateTransaction(ref, { sheets_state: 'pending', sheets_error: 'A newer decision needs synchronization.' });
    return this.store.getTransaction(ref);
  }

  async notify(refValue) {
    const ref = reference(refValue);
    let record = await this.store.getTransaction(ref);
    if (!record) throw new UserError('Transaction not found.', 404);
    if (record.status !== 'approved' && !(record.kind === 'expense' && record.decided_at)) return record;
    if (record.notification_state === 'sent') return record;
    const chatId = record.notification_chat_id ?? await this.notificationDestination(record);
    if (!chatId) {
      await this.store.updateTransaction(ref, { notification_state: 'no_recipient', notification_error: 'No Telegram recipient linked' });
      return this.store.getTransaction(ref);
    }
    record = await this.store.updateTransaction(ref, { notification_state: 'sending', notification_chat_id: chatId, notification_error: null }, { notification_state: record.notification_state });
    if (!record) return this.store.getTransaction(ref);
    try {
      await this.integrations.sendTelegram(chatId, decisionMessage(record));
      await this.store.updateTransaction(ref, { notification_state: 'sent', notification_error: null }, { notification_state: 'sending' });
    } catch (error) {
      await this.store.updateTransaction(ref, { notification_state: 'failed', notification_error: String(error.message ?? error).slice(0, 300) }, { notification_state: 'sending' });
    }
    return this.store.getTransaction(ref);
  }

  async retry(refValue, target, actor) {
    requireRole(actor, 'manager');
    const ref = reference(refValue);
    if (target === 'sheets') return this.sync(ref);
    if (target === 'telegram') return this.notify(ref);
    throw new UserError('Choose Sheets or Telegram retry.');
  }

  async linkTelegram(userIdValue, employee, actor) {
    requireRole(actor, 'manager');
    if (!EMPLOYEES[employee]) throw new UserError('Choose a valid employee.');
    const userId = String(userIdValue ?? '').trim();
    if (!/^\d+$/.test(userId)) throw new UserError('Enter a Telegram user ID from a visitor who started the bot.');
    const visitor = await this.store.getVisitor(userId);
    if (!visitor) throw new UserError('That Telegram user has not started the bot yet.');
    return this.store.setLink(userId, employee, visitor.chat_id);
  }
}
