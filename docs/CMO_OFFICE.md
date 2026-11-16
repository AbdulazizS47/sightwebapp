# CMO Office (Telegram group agent on Claude)

The CMO Office is a Claude-powered marketing agent that lives in a Telegram group with the owner and
whoever helps with marketing. It keeps a library of SIGHT's designs, remembers the brand rules, and
drafts posts from real sales data. The owner approves every draft with a button. It never publishes
anything itself.

## What it does

- **Design library.** Send Canva designs (PNG/JPG, or PDF for multi-page exports), photos, logos or
  the brand book to the group, with a caption saying what each is for. The file is stored in MySQL
  and Claude looks at it and catalogues it: title, type (post, story, menu, promo, logo, brand book…),
  a description including any text on it, tags, language, menu items shown and campaign.
- **Brand memory.** Starts with the SIGHT brand kit (voice, do's and don'ts, colors, fonts). Rules
  the owner states in the group ("never say cheap") become active at once; rules from other people
  are saved as suggestions until the owner activates them. A brand book PDF is read and turned into rules.
- **Drafts with real data.** Reads the live menu (names, prices, availability), open hours, sales
  and item performance from the ordering app, so it pushes what is selling and never invents prices.
- **Approval cards.** Each draft (post, story, reel, campaign or broadcast idea) is posted as a card
  with the design, Arabic and English captions, hashtags and the reason. Only approvers can press
  **Approve / Reject** (or **Approve all** for a batch). Approved cards get a **Mark as posted**
  button for whoever publishes it. Reply to a rejected card with what to change and it redrafts.
- **Schedule (Riyadh time).** A daily "open tonight" draft at `CMO_OFFICE_DAILY_TIME` (default
  14:00, before the 3 PM post) and a 7-day calendar every `CMO_OFFICE_WEEKLY_DAY` at
  `CMO_OFFICE_WEEKLY_TIME` (default Saturday 13:00).
- It cannot publish, send WhatsApp broadcasts, spend money, or change prices, menu, promotions or the app.

## Commands (in the group)

| Command | What it does |
|---|---|
| `/cmo_help` | How to use the CMO Office |
| `/cmo_today` | Draft today's post now |
| `/cmo_week` | Draft the next 7 days now |
| `/cmo_pending` | Re-post drafts waiting for approval |
| `/cmo_library` | List the designs it has |
| `/cmo_brand` | List the brand rules it follows, and suggestions waiting for the owner |
| `/cmo_summary` | Counts of designs, rules and drafts |
| `/cmo_setup` | Show the chat id and your Telegram user id (works in any chat) |

## Database

| Table | Holds |
|---|---|
| `cmo_assets` | Uploaded designs and files (bytes in MySQL, up to 20 MB each) with Claude's catalogue fields |
| `cmo_messages` | Every message in the group, both directions |
| `cmo_brand_notes` | Brand rules: starter, from chat, or from the brand book; `active`, `suggested` or `archived` |
| `cmo_proposals` | Drafts with captions, design, schedule, reason, status (`pending`, `approved`, `rejected`, `published`) and who reviewed them |

Claude runs are logged in `agent_runs` with channel `telegram_cmo`.

## Setup

1. Create a Telegram group called **CMO Office** and add the existing SIGHT bot.
2. If you have not already done it for the CFO Office: in `@BotFather` run `/setprivacy` → the bot →
   **Disable**, then remove and re-add the bot to the group.
3. Send `/cmo_setup` in the group. The bot replies with the chat id and your user id.
4. Create an API key at console.anthropic.com (set a monthly spend limit there).
5. On the Railway API service set:

```env
CMO_OFFICE_ENABLED=true
CMO_OFFICE_CHAT_ID=-100xxxxxxxxxx        # from /cmo_setup
CMO_OFFICE_APPROVER_USER_IDS=123456789   # defaults to CFO_OFFICE_APPROVER_USER_IDS
ANTHROPIC_API_KEY=sk-ant-...             # keep it only on the API service
CMO_OFFICE_MODEL=claude-opus-5-5         # or claude-sonnet-5-5 to cut cost
CMO_OFFICE_EFFORT=medium                 # low | medium | high
CMO_OFFICE_DAILY_TIME=14:00              # Riyadh time; empty disables the daily draft
CMO_OFFICE_WEEKLY_DAY=sat
CMO_OFFICE_WEEKLY_TIME=13:00             # empty disables the weekly plan
CMO_OFFICE_REPLY_MODE=all                # or "mentions" to only answer @mentions, replies and files
```

The CMO Office uses the same webhook as the other Telegram agents, so `TELEGRAM_AGENT_ENABLED`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_AGENT_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET` and `PUBLIC_BASE_URL`
must already be set. Redeploy.

6. Send your Canva designs to the group, each with a short caption ("story template for V60 nights",
   "Ramadan menu board"). Then try `/cmo_today`.

## Limits

- Images over 5 MB are stored but Claude cannot view them; send them as a compressed photo as well.
- Videos and voice notes are not read yet.
- Publishing is manual (no Instagram API yet): copy the approved caption, post, then tap **Mark as posted**.
- Everything written in the group is stored. Tell the team the group is recorded.
