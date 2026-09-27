import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { syncToSheets } from '../src/integrations.js';

test('Sheets sync writes pending and approved versions to the same assigned row', async () => {
  const originalFetch = globalThis.fetch;
  const originalAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const originalId = process.env.GOOGLE_SPREADSHEET_ID;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth2.googleapis.com/token'
  });
  process.env.GOOGLE_SPREADSHEET_ID = 'test-sheet';
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.includes('/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (address.endsWith('?fields=sheets.properties.title')) return Response.json({ sheets: [{ properties: { title: 'Sales' } }] });
    if (options.method === 'PUT') {
      writes.push({ url: address, values: JSON.parse(options.body).values });
      return Response.json({ updatedCells: 17 });
    }
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const pending = {
      ref: 'S02', sheet_row: 3, kind: 'sale', submitted_at: '2026-09-27T12:00:00Z', submitted_by: 'anastasia',
      customer: 'Daniel King', project: 'B', description: 'Friends and dancing', amount_cents: 200000,
      proposed_split: { richard: 0, anastasia: 50, jeanclaude: 50 }, final_split: null,
      commission_cents: null, status: 'pending'
    };
    await syncToSheets(pending);
    assert.deepEqual(writes[1].values[0].slice(10, 16), ['', '', '', 0, 0, 0]);
    await syncToSheets({ ...pending, status: 'approved', final_split: { richard: 20, anastasia: 40, jeanclaude: 40 }, commission_cents: { richard: 4000, anastasia: 8000, jeanclaude: 8000 } });
    assert.equal(writes.length, 4);
    assert.ok(writes[1].url.includes('Sales!A3%3AQ3'));
    assert.equal(writes[3].url, writes[1].url);
    assert.deepEqual(writes[3].values[0].slice(10, 16), [20, 40, 40, 40, 80, 80]);
    assert.equal(writes[3].values[0][16], 'Approved');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAccount === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalAccount;
    if (originalId === undefined) delete process.env.GOOGLE_SPREADSHEET_ID;
    else process.env.GOOGLE_SPREADSHEET_ID = originalId;
  }
});
