# CFO Office (Telegram group agent on Grok)

The CFO Office is a Grok-powered agent that lives in a Telegram group with the owner and staff.
It collects everything a CFO needs (costs, suppliers, staff and salaries, fixed costs, cash,
bank, loans, tax status, targets), asks for what is missing, and stores all of it in MySQL.

## What it does

- **Reads every message, photo and document in the group.** Grok (xAI) decides what is financial
  data and saves it as structured records: one record per item (a supplier bill becomes a
  `purchase` plus one `ingredient_cost` per line with unit cost).
- **Asks questions.** It starts with 19 CFO questions (`src/server/cfo-office/questions.js`) and
  posts the next ones at `CFO_OFFICE_QUESTION_TIMES`, in English and Arabic. Owner-only questions
  tag the approvers. Grok adds its own follow-up questions when something is missing or doesn't
  add up, and directs them to the person most likely to know.
- **Approvals.** Records from approvers are confirmed immediately. Records from everyone else are
  saved as `pending` and the bot posts Approve / Reject buttons that only approvers can press.
- **Answers money questions** from the stored records and from the ordering app's sales data.
- It cannot pay, transfer money, or change prices, orders, menu or inventory.

## Commands (in the group)

| Command | What it does |
|---|---|
| `/cfo_help` | How to use the CFO Office |
| `/cfo_questions` | What the CFO still needs to know |
| `/cfo_ask` | Ask the next questions now |
| `/cfo_pending` | Re-post records waiting for approval |
| `/cfo_summary` | Counts of what has been collected |
| `/cfo_setup` | Show the chat id and your Telegram user id (works in any chat) |

## Database

| Table | Holds |
|---|---|
| `cfo_messages` | Every message in the group, both directions, with sender and the question it answers |
| `cfo_attachments` | Photos, documents and voice notes (bytes stored in MySQL, up to 10 MB each) |
| `cfo_members` | People seen in the group, their role, and whether they are approvers |
| `cfo_questions` | Starter and follow-up questions with status (`open`, `answered`, `skipped`) and answer summary |
| `cfo_records` | Structured financial data: type, amount, VAT, quantity, unit, unit cost, frequency, counterparty, staff name, status, who submitted and who approved, and links to the source message and file |

Grok runs are logged in `agent_runs` with channel `telegram_cfo`.

## Setup

1. Create a Telegram group called **CFO Office** and add the existing SIGHT bot.
2. In `@BotFather`: `/setprivacy` → choose the bot → **Disable**, so the bot can read every
   group message (otherwise it only sees commands and replies to it). Remove and re-add the bot to
   the group after changing this.
3. Make the bot a group admin (recommended).
4. Send `/cfo_setup` in the group. The bot replies with the chat id and your user id.
5. On the Railway API service set:

```env
CFO_OFFICE_ENABLED=true
CFO_OFFICE_CHAT_ID=-100xxxxxxxxxx        # from /cfo_setup
CFO_OFFICE_APPROVER_USER_IDS=123456789   # your Telegram user id; comma-separate several
XAI_API_KEY=xai-...                      # from console.x.ai, keep it only on the API service
CFO_OFFICE_MODEL=grok-4                  # any current Grok model with image input
CFO_OFFICE_QUESTION_TIMES=10:00,17:00    # Riyadh time; empty disables scheduled questions
CFO_OFFICE_QUESTIONS_PER_ROUND=2
CFO_OFFICE_REPLY_MODE=all                # or "mentions" to only answer @mentions/replies/files
```

The CFO Office uses the same webhook as the operational Telegram agent, so `TELEGRAM_AGENT_ENABLED`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_AGENT_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET` and `PUBLIC_BASE_URL`
must already be set. Redeploy; the API re-registers the webhook to also receive button presses.

`/cfo_setup` answers in any chat before `CFO_OFFICE_CHAT_ID` is set, as long as
`CFO_OFFICE_ENABLED=true`.

If the group is upgraded to a supergroup its chat id changes; the API logs the new id and you
update `CFO_OFFICE_CHAT_ID`.

## Limits

- PDFs and voice notes are stored but Grok can't read them yet; it asks for a photo or the key
  figures instead.
- Everything people write in the group is stored. Tell the team the group is recorded.
