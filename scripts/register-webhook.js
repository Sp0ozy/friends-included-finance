const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = process.env.SITE_URL;

if (!token || !secret || !site) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and SITE_URL in .env first.');
  process.exitCode = 1;
} else {
  const url = new URL('/api/telegram', site).toString();
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'] })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    console.error(`Webhook setup failed: ${data.description ?? response.status}`);
    process.exitCode = 1;
  } else console.log(`Webhook registered: ${url}`);
}
