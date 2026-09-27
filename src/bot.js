import { EMPLOYEES, UserError, euro } from './domain.js';

function splitFromText(value) {
  const parts = value.split('/').map(part => part.trim());
  if (parts.length !== 3) throw new UserError('Split must be three percentages such as 50/30/20.');
  return { richard: parts[0], anastasia: parts[1], jeanclaude: parts[2] };
}

export async function processBotMessage(message, store, service, send) {
  if (message?.chat?.type !== 'private' || !message.from?.id) return;
  const userId = String(message.from.id);
  const chatId = String(message.chat.id);
  const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ');
  await store.saveVisitor(userId, chatId, name);
  const content = String(message.text ?? '').trim();
  if (content === '/start' || content === '/help') {
    const link = await store.getLink(userId);
    const intro = link ? `Linked to ${EMPLOYEES[link.employee_slug].name}.` : `Your Telegram user ID is ${userId}. Ask the manager to link it on the website before submitting.`;
    await send(chatId, `${intro}\nSales: /sale S01 | Olivia Rose | A | Description | 1000 | 50/30/20\nExpenses: /expense E01 | Description | Materials | 120 | A\nUse A, B, or overhead for expenses.`);
    return;
  }
  const link = await store.getLink(userId);
  if (!link) {
    await send(chatId, `You are not linked to an employee. Your Telegram user ID is ${userId}. Ask the manager to link it on the website.`);
    return;
  }
  try {
    const [commandPart, ...fields] = content.split('|').map(part => part.trim());
    const [command, ref] = commandPart.split(/\s+/);
    let record;
    if (command === '/sale') {
      if (fields.length !== 5) throw new UserError('Use /sale REF | Customer | A or B | Description | Amount | Richard/Anastasia/Jean-Claude percentages.');
      record = await service.submitSale({ ref, customer: fields[0], project: fields[1], description: fields[2], amount: fields[3], split: splitFromText(fields[4]) }, { employee: link.employee_slug, source: 'telegram', chatId });
      await send(chatId, `Recorded sale ${record.ref}: ${euro(record.amount_cents)}, project ${record.project}, Pending approval.${record.sheets_state === 'synced' ? '' : ' Sheets sync pending/failed; the manager can retry.'}`);
    } else if (command === '/expense') {
      if (fields.length !== 4) throw new UserError('Use /expense REF | Description | Materials, Travel, or Other | Amount | A, B, or overhead.');
      const allocation = fields[3].toLowerCase() === 'overhead' ? 'overhead' : fields[3].toUpperCase();
      record = await service.submitExpense({ ref, description: fields[0], category: fields[1], amount: fields[2], allocation }, { employee: link.employee_slug, source: 'telegram', chatId });
      await send(chatId, `Recorded expense ${record.ref}: ${euro(record.amount_cents)}, proposed ${record.proposed_allocation === 'overhead' ? 'Company overhead' : `project ${record.proposed_allocation}`}, ${record.status === 'allocated' ? 'Allocated automatically' : 'Awaiting allocation'}.${record.sheets_state === 'synced' ? '' : ' Sheets sync pending/failed; the manager can retry.'}`);
    } else {
      await send(chatId, 'Unknown command. Send /help for the two submission formats.');
    }
  } catch (error) {
    await send(chatId, `Could not record the transaction: ${error instanceof UserError ? error.message : 'server error; ask the manager to check the integration settings.'}`);
    if (!(error instanceof UserError)) console.error(error);
  }
}
