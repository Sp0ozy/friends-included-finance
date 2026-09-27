export const EMPLOYEES = Object.freeze({
  richard: { name: 'Richard Darling', role: 'sales' },
  anastasia: { name: 'Anastasia Ferrari', role: 'sales' },
  jeanclaude: { name: 'Jean-Claude Berzins', role: 'sales' },
  kevin: { name: 'Kevin von Whatever', role: 'expense' },
  svetlana: { name: 'Svetlana de Monte Carlo', role: 'manager' }
});

export const SALESPEOPLE = ['richard', 'anastasia', 'jeanclaude'];
export const PROJECTS = { A: 'Respectable Relatives', B: 'Drunk University Friends' };
export const ALLOCATIONS = { A: PROJECTS.A, B: PROJECTS.B, overhead: 'Company overhead' };
export const CATEGORIES = ['Materials', 'Travel', 'Other'];

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

export function requireRole(employee, expected) {
  if (!EMPLOYEES[employee] || EMPLOYEES[employee].role !== expected) {
    throw new UserError(`Only a ${expected} employee can perform this action.`, 403);
  }
}

export function requiredText(value, label, max = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new UserError(`${label} is required and must be at most ${max} characters.`);
  return result;
}

export function reference(value) {
  const result = requiredText(value, 'Reference', 24).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]*$/.test(result)) throw new UserError('Reference must start with a letter and contain only letters, numbers, hyphens, or underscores.');
  return result;
}

export function moneyToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new UserError('Amount must be a positive euro amount with at most two decimals.');
  const [euros, fractional = ''] = text.split('.');
  const cents = Number(euros) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new UserError('Amount must be greater than zero.');
  return cents;
}

export function validateSplit(value) {
  if (!value || typeof value !== 'object') throw new UserError('Enter all three commission percentages.');
  const split = {};
  for (const person of SALESPEOPLE) {
    const raw = value[person];
    if (raw === '' || raw === null || raw === undefined) throw new UserError(`Enter ${EMPLOYEES[person].name}'s percentage.`);
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > 100) throw new UserError('Each commission share must be a whole percentage from 0 to 100.');
    split[person] = number;
  }
  if (SALESPEOPLE.reduce((sum, person) => sum + split[person], 0) !== 100) throw new UserError('Commission shares must add to 100%.');
  return split;
}

export function validateSale(input, employee) {
  requireRole(employee, 'sales');
  const project = requiredText(input.project, 'Project', 1).toUpperCase();
  if (!PROJECTS[project]) throw new UserError('Project must be A or B.');
  return {
    ref: reference(input.ref), kind: 'sale', submitted_by: employee,
    source: input.source === 'telegram' ? 'telegram' : 'website',
    origin_chat_id: input.origin_chat_id ?? null,
    customer: requiredText(input.customer, 'Customer', 120),
    project, description: requiredText(input.description, 'Description'),
    amount_cents: moneyToCents(input.amount),
    proposed_split: validateSplit(input.split),
    status: 'pending', notification_state: 'not_applicable'
  };
}

export function validateExpense(input, employee) {
  requireRole(employee, 'expense');
  const category = requiredText(input.category, 'Category', 20);
  if (!CATEGORIES.includes(category)) throw new UserError('Category must be Materials, Travel, or Other.');
  const allocation = requiredText(input.allocation, 'Allocation', 20);
  if (!ALLOCATIONS[allocation]) throw new UserError('Allocation must be A, B, or Company overhead.');
  return {
    ref: reference(input.ref), kind: 'expense', submitted_by: employee,
    source: input.source === 'telegram' ? 'telegram' : 'website',
    origin_chat_id: input.origin_chat_id ?? null,
    description: requiredText(input.description, 'Description'),
    amount_cents: moneyToCents(input.amount), category,
    proposed_allocation: allocation,
    final_allocation: allocation === 'overhead' ? 'overhead' : null,
    status: allocation === 'overhead' ? 'allocated' : 'awaiting_allocation',
    notification_state: 'not_applicable'
  };
}

export function commissions(amountCents, split) {
  const valid = validateSplit(split);
  const pool = Math.round(amountCents / 10);
  const earned = Object.fromEntries(SALESPEOPLE.map(person => [person, Math.round(pool * valid[person] / 100)]));
  const remainder = pool - SALESPEOPLE.reduce((sum, person) => sum + earned[person], 0);
  const largest = SALESPEOPLE.reduce((best, person) => valid[person] > valid[best] ? person : best, SALESPEOPLE[0]);
  earned[largest] += remainder;
  return { pool, earned };
}

export function totals(records) {
  const projects = { A: { income: 0, commissions: 0, expenses: 0, result: 0 }, B: { income: 0, commissions: 0, expenses: 0, result: 0 } };
  const people = Object.fromEntries(SALESPEOPLE.map(person => [person, 0]));
  let overhead = 0;
  let awaiting = 0;
  let allExpenses = 0;
  for (const record of records) {
    if (record.kind === 'sale' && record.status === 'approved') {
      projects[record.project].income += record.amount_cents;
      const commission = record.commission_cents ?? commissions(record.amount_cents, record.final_split).earned;
      for (const person of SALESPEOPLE) {
        projects[record.project].commissions += commission[person];
        people[person] += commission[person];
      }
    }
    if (record.kind === 'expense') {
      allExpenses += record.amount_cents;
      if (record.status === 'awaiting_allocation') awaiting += record.amount_cents;
      else if (record.final_allocation === 'overhead') overhead += record.amount_cents;
      else projects[record.final_allocation].expenses += record.amount_cents;
    }
  }
  for (const project of Object.values(projects)) project.result = project.income - project.commissions - project.expenses;
  const income = projects.A.income + projects.B.income;
  const commissionTotal = projects.A.commissions + projects.B.commissions;
  return { projects, people, company: { income, commissions: commissionTotal, allocatedExpenses: projects.A.expenses + projects.B.expenses, overhead, awaiting, allExpenses, result: income - commissionTotal - allExpenses } };
}

export function euro(cents) {
  return `€${(cents / 100).toFixed(2)}`;
}
