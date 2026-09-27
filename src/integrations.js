import { createSign } from 'node:crypto';
import { ALLOCATIONS, EMPLOYEES, SALESPEOPLE, euro } from './domain.js';

const SALES_HEADER = [
  'Reference', 'Submission time', 'Salesperson', 'Customer', 'Project', 'Description', 'Amount EUR',
  'Proposed Richard %', 'Proposed Anastasia %', 'Proposed Jean-Claude %',
  'Approved Richard %', 'Approved Anastasia %', 'Approved Jean-Claude %',
  'Richard earned EUR', 'Anastasia earned EUR', 'Jean-Claude earned EUR', 'Status'
];
const EXPENSES_HEADER = ['Reference', 'Submission time', 'Reporter', 'Description', 'Category', 'Amount EUR', 'Proposed allocation', 'Final allocation', 'Status'];

let tokenCache = null;

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Google Sheets service account is not configured.');
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key) throw new Error('Google Sheets service account is incomplete.');
  return account;
}

async function googleToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const base = part => Buffer.from(JSON.stringify(part)).toString('base64url');
  const unsigned = `${base({ alg: 'RS256', typ: 'JWT' })}.${base({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: account.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(account.private_key.replace(/\\n/g, '\n')).toString('base64url')}`;
  const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google token request failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
  const body = await response.json();
  tokenCache = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return tokenCache.value;
}

async function sheetsRequest(path, method = 'GET', body = null) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('Google spreadsheet ID is not configured.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await googleToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`Google Sheets ${method} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function ensureTab(name, header) {
  const meta = await sheetsRequest('?fields=sheets.properties.title');
  if (!meta.sheets?.some(sheet => sheet.properties.title === name)) {
    try {
      await sheetsRequest(':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: name } } }] });
    } catch (error) {
      const current = await sheetsRequest('?fields=sheets.properties.title');
      if (!current.sheets?.some(sheet => sheet.properties.title === name)) throw error;
    }
  }
  await writeRange(`${name}!A1:${name === 'Sales' ? 'Q' : 'I'}1`, [header]);
}

async function writeRange(range, values) {
  return sheetsRequest(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, 'PUT', { values });
}

function salesRow(record) {
  const final = record.final_split ?? {};
  const earned = record.commission_cents ?? {};
  return [
    record.ref, record.submitted_at, EMPLOYEES[record.submitted_by].name, record.customer, record.project,
    record.description, record.amount_cents / 100,
    ...SALESPEOPLE.map(person => record.proposed_split[person]),
    ...SALESPEOPLE.map(person => final[person] ?? ''),
    ...SALESPEOPLE.map(person => (earned[person] ?? 0) / 100),
    record.status === 'approved' ? 'Approved' : 'Pending approval'
  ];
}

function expenseRow(record) {
  return [
    record.ref, record.submitted_at, EMPLOYEES[record.submitted_by].name, record.description,
    record.category, record.amount_cents / 100, ALLOCATIONS[record.proposed_allocation],
    record.final_allocation ? ALLOCATIONS[record.final_allocation] : '',
    record.status === 'allocated' ? 'Allocated' : 'Awaiting allocation'
  ];
}

export async function syncToSheets(record) {
  const name = record.kind === 'sale' ? 'Sales' : 'Expenses';
  const header = name === 'Sales' ? SALES_HEADER : EXPENSES_HEADER;
  const lastColumn = name === 'Sales' ? 'Q' : 'I';
  await ensureTab(name, header);
  const values = [record.kind === 'sale' ? salesRow(record) : expenseRow(record)];
  if (!Number.isInteger(record.sheet_row) || record.sheet_row < 2) throw new Error('Transaction has no assigned Google Sheets row.');
  await writeRange(`${name}!A${record.sheet_row}:${lastColumn}${record.sheet_row}`, values);
}

export async function sendTelegram(chatId, message) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram delivery failed: ${data.description ?? response.status}`);
  return data;
}

export function decisionMessage(record) {
  if (record.kind === 'sale') {
    const changed = SALESPEOPLE.some(person => record.proposed_split[person] !== record.final_split[person]);
    const lines = [
      `Sale ${record.ref} approved${changed ? ' — commission split changed' : ''}.`,
      `Sale ${euro(record.amount_cents)}; total commission ${euro(Math.round(record.amount_cents / 10))}.`
    ];
    for (const person of SALESPEOPLE) {
      const before = record.proposed_split[person];
      const after = record.final_split[person];
      lines.push(`${EMPLOYEES[person].name}: ${changed ? `${before}% → ` : ''}${after}% (${euro(record.commission_cents[person])})`);
    }
    return lines.join('\n');
  }
  const changed = record.proposed_allocation !== record.final_allocation;
  return `Expense ${record.ref} — allocation ${changed ? 'changed' : 'confirmed'}.\n${euro(record.amount_cents)}: ${record.description}\nProposed: ${ALLOCATIONS[record.proposed_allocation]}.\nApproved: ${ALLOCATIONS[record.final_allocation]}.`;
}
