# Friends Included finance desk

Day 4 homework for Iļja Molčanovs (220605). The application accepts fictional wedding-guest sales and expenses through one Telegram bot or the website. Supabase stores the records and manager decisions; Vercel hosts the website and API; Google Sheets receives an automatically updated copy.

## Current state

The application and its automated tests are built. The [Google Sheet](https://docs.google.com/spreadsheets/d/1_h3iKcl-JJujSPhhNleP45wIoFm6KgNgLMKngw0vK3k/edit) has the required `Sales` and `Expenses` tabs and was shared as a reader with the owner of the course submission sheet. The [Vercel project](https://friends-included-finance-phi.vercel.app) serves the website and API, and the [GitHub repository](https://github.com/Sp0ozy/friends-included-finance) has been created. The deployment currently has no Supabase, Google service-account, or Telegram credentials, and the repository awaits an approved initial commit. The automated tests calculate the assignment's final €3,930 result, but they do not stand in for the required live bot and website tests.

## Architecture and rules

- Website requests and Telegram submissions call the same `FinanceService`. The website's demonstration role is checked by the server for each action. Telegram identity comes from its user ID and a manager-created link; the bot cannot self-assign a role.
- Sales remain pending until Svetlana approves a final split. Approval records the sale and the rounded 10% commission pool once. The original proposal stays on the record.
- All expenses reduce company result when saved. Project expenses stay awaiting allocation until Svetlana decides. Company overhead allocates automatically. Changing allocation never deducts the expense a second time.
- The database assigns a stable Google Sheets row per reference. Sync retries write that same row. Sheets and Telegram delivery states are separate from the financial status, so a delivery failure cannot undo a saved record.
- Bot submissions store their original chat ID. Relinking the Telegram user later changes who can submit, but not where the original submission's decision notice goes.

## Set up the live system

1. [Create a Supabase project](https://supabase.com/docs/guides/getting-started/quickstarts/refine). Run [`sql/schema.sql`](sql/schema.sql) in its SQL Editor. Copy the project URL and a **secret** API key for server-side use. The SQL enables RLS and grants no public policies; the website never receives the secret key.
2. In Google Cloud, enable the Google Sheets API, create a service account, and [obtain its JSON key](https://docs.cloud.google.com/iam/docs/keys-create-delete). Share the [Google Sheet](https://docs.google.com/spreadsheets/d/1_h3iKcl-JJujSPhhNleP45wIoFm6KgNgLMKngw0vK3k/edit) with that service account email as **Editor**. Its ID is `1_h3iKcl-JJujSPhhNleP45wIoFm6KgNgLMKngw0vK3k`. The instructor's viewer permission is already set on the Sheet.
3. [Create one Telegram bot through BotFather](https://core.telegram.org/bots/tutorial). Save its token and a random webhook secret. The webhook secret must use letters, numbers, underscores, or hyphens. Do not put either value in GitHub or the public page.
4. Publish this project to an instructor-accessible GitHub repository and import that repository into Vercel. Add all variables from [`.env.example`](.env.example) as Vercel server environment variables, replacing placeholders. Put the service-account JSON in one environment variable named `GOOGLE_SERVICE_ACCOUNT_JSON`; preserve its JSON structure. Redeploy after adding variables. `/api?action=health` reports which integrations are configured without revealing their values.
5. Register the Telegram webhook to `https://YOUR_DEPLOYMENT.vercel.app/api/telegram` using `setWebhook` with the same `TELEGRAM_WEBHOOK_SECRET`. A local `.env` containing the token, secret, and `SITE_URL` lets `npm run webhook` perform registration after deployment. Set `PUBLIC_BOT_URL` and `PUBLIC_REPO_URL` on Vercel so the page displays all three review links.
6. Start the bot in a private Telegram chat. It replies with your Telegram user ID. In the website's Svetlana demonstration role, link that ID to Richard, then later to Kevin and Jean-Claude as the test instructions specify.

## Verify and submit

Run `npm test` for the calculation and processing-layer tests. For local inspection, run `npm start`; without Supabase credentials, the site correctly displays a connection error.

Before the live tests, clear practice transactions from the new Supabase project and clear corresponding practice rows in the Sheet. Then follow the assignment's Test 1 and Test 2 in order. **S01 and E01 must be submitted through the actual Telegram bot**; enter the remaining cases through the website's role selector. Leave S05 pending and E07 awaiting allocation. After the two tests, the dashboard must show A €2,050, B €2,180, company €3,930, and commissions of €140 / €175 / €215. Check the actual Sheet rows and Telegram notifications, refresh the page, and run the denial and retry checks. The application does not seed or hard-code these results.

Put the final working Vercel URL in your own row and the Day 4 column of the [course submission sheet](https://docs.google.com/spreadsheets/d/1AZ__P96ArJzLLTs6kGVPPIDS8229bhYcKgGu6I8O7wk/edit). Do not edit classmates' rows.
