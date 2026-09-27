const $ = id => document.getElementById(id);
const names = { richard: 'Richard', anastasia: 'Anastasia', jeanclaude: 'Jean-Claude', kevin: 'Kevin', svetlana: 'Svetlana' };
const projects = { A: 'Respectable Relatives', B: 'Drunk University Friends', overhead: 'Company overhead' };
const people = ['richard', 'anastasia', 'jeanclaude'];
let role = localStorage.getItem('friendsIncludedRole') || 'svetlana';
let state = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function eur(cents) { return `€${(Number(cents || 0) / 100).toFixed(2)}`; }
function notice(message, error = false) {
  const target = $('message'); target.hidden = false; target.className = `message${error ? ' error' : ''}`; target.textContent = message;
}
async function api(action, body = null) {
  const url = body ? '/api' : `/api?action=${encodeURIComponent(action)}&role=${encodeURIComponent(role)}`;
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, role, ...body }) } : {});
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'Request failed.');
  return result.data;
}
async function refresh() {
  try {
    state = await api('state');
    render();
  } catch (error) {
    $('entry').innerHTML = `<h2>Connection needed</h2><p class="error-text">${esc(error.message)}</p>`;
    $('dashboard').hidden = true; $('manager').hidden = true; $('records').innerHTML = '';
  }
}
function field(label, name, type = 'text', extra = '') {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${extra} required></div>`;
}
function renderEntry() {
  if (people.includes(role)) {
    $('entry').innerHTML = `<h2>Enter a sale</h2><form id="saleForm"><div class="grid">
      ${field('Reference', 'ref', 'text', 'placeholder="S06" maxlength="24"')}
      ${field('Customer', 'customer')}
      <div class="field"><label for="project">Project</label><select id="project" name="project"><option value="A">A · Respectable Relatives</option><option value="B">B · Drunk University Friends</option></select></div>
      ${field('Amount (€)', 'amount', 'number', 'min="0.01" step="0.01"')}
      <div class="field"><label for="description">Description</label><textarea id="description" name="description" required></textarea></div>
      <div class="field"><label>Proposed commission split · total 100%</label><div class="action-row">${people.map(person => `<label>${names[person]} <input class="compact" name="${person}" type="number" min="0" max="100" step="1" required></label>`).join('')}</div></div>
    </div><div class="form-actions"><button>Save pending sale</button></div></form>`;
    $('saleForm').addEventListener('submit', submitSale);
  } else if (role === 'kevin') {
    $('entry').innerHTML = `<h2>Enter a paid expense</h2><form id="expenseForm"><div class="grid">
      ${field('Reference', 'ref', 'text', 'placeholder="E08" maxlength="24"')}
      ${field('Amount (€)', 'amount', 'number', 'min="0.01" step="0.01"')}
      <div class="field"><label for="category">Category</label><select id="category" name="category"><option>Materials</option><option>Travel</option><option>Other</option></select></div>
      <div class="field"><label for="allocation">Proposed allocation</label><select id="allocation" name="allocation"><option value="A">A · Respectable Relatives</option><option value="B">B · Drunk University Friends</option><option value="overhead">Company overhead</option></select></div>
      <div class="field"><label for="description">Description</label><textarea id="description" name="description" required></textarea></div>
    </div><div class="form-actions"><button>Save paid expense</button></div></form>`;
    $('expenseForm').addEventListener('submit', submitExpense);
  } else {
    $('entry').innerHTML = '<h2>Manager desk</h2><p>Use the decisions below to approve or correct submitted records. Employees create the routine entries.</p>';
  }
}
async function submitSale(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const saved = await api('sale', { ...data, split: Object.fromEntries(people.map(person => [person, data[person]])) });
    notice(`${saved.ref} saved as Pending approval. Sheets: ${saved.sheets_state}.`); event.currentTarget.reset(); await refresh();
  } catch (error) { notice(error.message, true); }
}
async function submitExpense(event) {
  event.preventDefault();
  try {
    const saved = await api('expense', Object.fromEntries(new FormData(event.currentTarget)));
    notice(`${saved.ref} saved as ${saved.status.replaceAll('_', ' ')}. Sheets: ${saved.sheets_state}.`); event.currentTarget.reset(); await refresh();
  } catch (error) { notice(error.message, true); }
}
function metric(label, data) {
  return `<div class="metric"><h3>${label}</h3><dl><dt>Approved income</dt><dd>${eur(data.income)}</dd><dt>Commissions</dt><dd>${eur(data.commissions)}</dd><dt>Allocated expenses</dt><dd>${eur(data.expenses)}</dd><dt>Result</dt><dd class="result">${eur(data.result)}</dd></dl></div>`;
}
function renderDashboard() {
  const target = $('dashboard'); target.hidden = role !== 'svetlana'; if (target.hidden) return;
  const t = state.totals;
  target.innerHTML = `<h2>Financial dashboard</h2><div class="metrics">
    ${metric('A · Respectable Relatives', t.projects.A)}${metric('B · Drunk University Friends', t.projects.B)}
    <div class="metric"><h3>Whole company</h3><dl><dt>Approved income</dt><dd>${eur(t.company.income)}</dd><dt>Commissions</dt><dd>${eur(t.company.commissions)}</dd><dt>Allocated project expenses</dt><dd>${eur(t.company.allocatedExpenses)}</dd><dt>Company overhead</dt><dd>${eur(t.company.overhead)}</dd><dt>Awaiting allocation</dt><dd>${eur(t.company.awaiting)}</dd><dt>Result</dt><dd class="result">${eur(t.company.result)}</dd></dl></div>
  </div><div class="divider" style="margin-top:18px"><h3>Commission earned</h3><p>${people.map(person => `${names[person]}: <strong>${eur(t.people[person])}</strong>`).join(' &nbsp; · &nbsp; ')}</p><p class="muted">Project A result + Project B result − overhead − awaiting allocation = company result.</p></div>`;
}
function syncAndDelivery(record) {
  const sync = record.sheets_state === 'synced' ? '<span class="pill good">Sheets synced</span>' : `<span class="pill alert">Sync ${esc(record.sheets_state)}</span>`;
  let delivery = '';
  if (record.status === 'approved' || (record.kind === 'expense' && record.decided_at)) {
    if (record.notification_state === 'no_recipient') delivery = '<span class="pill alert">No Telegram recipient linked</span>';
    else delivery = `<span class="pill ${record.notification_state === 'sent' ? 'good' : 'alert'}">Telegram ${esc(record.notification_state)}</span>`;
  }
  return `<div class="action-row">${sync}${delivery}</div>${record.sheets_error ? `<p class="small error-text">${esc(record.sheets_error)}</p>` : ''}${record.notification_error ? `<p class="small error-text">${esc(record.notification_error)}</p>` : ''}`;
}
function renderRecords() {
  const sales = state.records.filter(record => record.kind === 'sale');
  const expenses = state.records.filter(record => record.kind === 'expense');
  $('records').innerHTML = `<div class="section-head"><h2>${role === 'svetlana' ? 'All records' : 'Your submissions'}</h2><span class="muted">${state.records.length} entries</span></div>
    <h3>Sales</h3><div class="table-wrap"><table><thead><tr><th>Ref / time</th><th>Salesperson / customer</th><th>Project / description</th><th>Amount</th><th>Proposed split</th><th>Final split / earned</th><th>Status / delivery</th></tr></thead><tbody>${sales.map(record => `<tr><td><strong>${esc(record.ref)}</strong><br><span class="small muted">${esc(new Date(record.submitted_at).toLocaleString())}</span></td><td>${esc(names[record.submitted_by])}<br>${esc(record.customer)}</td><td>${esc(projects[record.project])}<br><span class="small">${esc(record.description)}</span></td><td>${eur(record.amount_cents)}</td><td>${people.map(person => `${names[person]} ${record.proposed_split[person]}%`).join('<br>')}</td><td>${record.final_split ? people.map(person => `${names[person]} ${record.final_split[person]}% · ${eur(record.commission_cents[person])}`).join('<br>') : '—'}</td><td><span class="pill ${record.status === 'pending' ? 'alert' : 'good'}">${esc(record.status)}</span><br>${syncAndDelivery(record)}${retryButtons(record)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No sales yet.</td></tr>'}</tbody></table></div>
    <h3 class="divider">Expenses</h3><div class="table-wrap"><table><thead><tr><th>Ref / time</th><th>Reporter / description</th><th>Category</th><th>Amount</th><th>Proposed</th><th>Final</th><th>Status / delivery</th></tr></thead><tbody>${expenses.map(record => `<tr><td><strong>${esc(record.ref)}</strong><br><span class="small muted">${esc(new Date(record.submitted_at).toLocaleString())}</span></td><td>${esc(names[record.submitted_by])}<br>${esc(record.description)}</td><td>${esc(record.category)}</td><td>${eur(record.amount_cents)}</td><td>${esc(projects[record.proposed_allocation])}</td><td>${record.final_allocation ? esc(projects[record.final_allocation]) : '—'}</td><td><span class="pill ${record.status === 'awaiting_allocation' ? 'alert' : 'good'}">${esc(record.status.replaceAll('_', ' '))}</span><br>${syncAndDelivery(record)}${retryButtons(record)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No expenses yet.</td></tr>'}</tbody></table></div>`;
}
function retryButtons(record) {
  if (role !== 'svetlana') return '';
  const sheets = record.sheets_state !== 'synced' ? `<button class="secondary" data-retry="sheets" data-ref="${esc(record.ref)}">Retry Sheets</button>` : '';
  const telegram = ['failed', 'sending', 'no_recipient'].includes(record.notification_state) ? `<button class="secondary" data-retry="telegram" data-ref="${esc(record.ref)}">Retry Telegram</button>` : '';
  return sheets || telegram ? `<div class="action-row">${sheets}${telegram}</div>` : '';
}
function renderManager() {
  const target = $('manager'); target.hidden = role !== 'svetlana'; if (target.hidden) return;
  const pending = state.records.filter(record => record.status === 'pending');
  const awaiting = state.records.filter(record => record.status === 'awaiting_allocation');
  target.innerHTML = `<h2>Manager decisions</h2><div class="stack"><div><h3>Sales awaiting approval</h3>${pending.map(record => `<div class="divider"><strong>${esc(record.ref)}</strong> · ${esc(names[record.submitted_by])} · ${eur(record.amount_cents)} · ${esc(projects[record.project])}<p class="small">Original proposal: ${people.map(person => `${names[person]} ${record.proposed_split[person]}%`).join(' / ')}</p><div class="action-row">${people.map(person => `<label>${names[person]} <input class="compact" type="number" min="0" max="100" value="${record.proposed_split[person]}" data-split="${esc(record.ref)}" data-person="${person}"></label>`).join('')}<button data-approve-sale="${esc(record.ref)}">Approve sale</button></div></div>`).join('') || '<p class="muted">No pending sales.</p>'}</div>
  <div><h3>Expenses awaiting allocation</h3>${awaiting.map(record => `<div class="divider"><strong>${esc(record.ref)}</strong> · ${eur(record.amount_cents)} · ${esc(record.description)}<p class="small">Original proposal: ${esc(projects[record.proposed_allocation])}</p><div class="action-row"><select data-allocation="${esc(record.ref)}"><option value="A" ${record.proposed_allocation === 'A' ? 'selected' : ''}>A · Respectable Relatives</option><option value="B" ${record.proposed_allocation === 'B' ? 'selected' : ''}>B · Drunk University Friends</option><option value="overhead">Company overhead</option></select><button data-approve-expense="${esc(record.ref)}">Confirm allocation</button></div></div>`).join('') || '<p class="muted">No expenses awaiting allocation.</p>'}</div>
  <div><h3>Telegram manager setup</h3><p class="muted">Ask the employee to start the bot. Their Telegram user ID will appear here. Linking or relinking changes the current bot role; older bot submissions retain their original chat.</p>${state.visitors.map(visitor => { const linked = state.links.find(link => link.telegram_user_id === visitor.telegram_user_id); return `<div class="divider action-row"><span><strong>${esc(visitor.display_name || 'Telegram user')}</strong> · ID ${esc(visitor.telegram_user_id)}${linked ? ` · linked to ${esc(names[linked.employee_slug])}` : ' · unlinked'}</span><select data-link="${esc(visitor.telegram_user_id)}">${Object.keys(names).map(person => `<option value="${person}" ${linked?.employee_slug === person ? 'selected' : ''}>${names[person]}</option>`).join('')}</select><button data-link-user="${esc(visitor.telegram_user_id)}">Save link</button></div>`; }).join('') || '<p class="muted">No Telegram visitors yet. Start the bot in a private chat.</p>'}</div></div>`;
}
function render() { renderEntry(); renderDashboard(); renderManager(); renderRecords(); }

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  const sale = button.dataset.approveSale, expense = button.dataset.approveExpense, retry = button.dataset.retry, link = button.dataset.linkUser;
  if (!sale && !expense && !retry && !link) return;
  button.disabled = true;
  try {
    if (sale) {
      const split = Object.fromEntries(people.map(person => [person, document.querySelector(`input[data-split="${sale}"][data-person="${person}"]`).value]));
      await api('approveSale', { ref: sale, split }); notice(`${sale} approved.`);
    } else if (expense) {
      await api('approveExpense', { ref: expense, allocation: document.querySelector(`select[data-allocation="${expense}"]`).value }); notice(`${expense} allocated.`);
    } else if (retry) {
      const result = await api('retry', { ref: button.dataset.ref, target: retry }); notice(`${result.ref}: ${retry} ${retry === 'sheets' ? result.sheets_state : result.notification_state}.`);
    } else {
      const employee = document.querySelector(`select[data-link="${link}"]`).value;
      await api('linkTelegram', { userId: link, employee }); notice(`Telegram user ${link} linked to ${names[employee]}.`);
    }
    await refresh();
  } catch (error) { notice(error.message, true); button.disabled = false; }
});

$('role').value = names[role] ? role : 'svetlana'; role = $('role').value;
$('role').addEventListener('change', event => { role = event.target.value; localStorage.setItem('friendsIncludedRole', role); $('message').hidden = true; refresh(); });
api('config').then(config => {
  const links = [['Open Telegram bot', config.botUrl], ['View Google Sheet', config.sheetUrl], ['View GitHub code', config.repoUrl]];
  $('links').innerHTML = links.map(([label, url]) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : `<span class="muted">${label}: setup pending</span>`).join('');
}).catch(() => {});
refresh();
