# SIGHT Operational Manager

The operational manager is a read-only Telegram assistant built in two layers:

1. Deterministic operations services calculate every business metric from MySQL.
2. The OpenAI Responses API interprets owner questions and selects only registered read tools.

The model never receives database credentials and cannot execute arbitrary SQL.

## Capabilities

The agent can answer natural English and Arabic questions about:

- Sales for a day or date range
- Previous-period sales comparisons
- Product performance by quantity or revenue
- Open orders
- Current inventory quantities and thresholds
- Low and out-of-stock inventory
- Estimated inventory days remaining
- Recorded sale consumption, waste, corrections, adjustments, and restocks
- Missing inventory usage rules and thresholds
- Combined operational briefings

Profit and margin are intentionally unavailable because the application does not yet store
cost-of-goods data.

## Telegram commands

- `/today`
- `/yesterday`
- `/report YYYY-MM-DD`
- `/operations`
- `/reset`
- `/help`

The original report commands remain deterministic. Natural-language questions and `/operations`
use OpenAI when the operational-agent configuration is ready.

## Architecture

```text
Telegram webhook
  -> authorized-chat check
  -> deterministic command router
  -> operational manager for natural-language requests
  -> strict read-only tool registry
  -> operations services
  -> MySQL
```

Operations services:

```text
src/server/operations/
  date-utils.js
  sales.js
  inventory.js
  overview.js
```

Agent services:

```text
src/server/agent/
  conversations.js
  tools.js
  operational-manager.js
```

## Read-only tools

- `get_sales_summary`
- `get_product_performance`
- `get_inventory_snapshot`
- `get_inventory_risks`
- `get_inventory_movements`
- `get_open_orders`
- `get_data_quality_report`
- `get_operational_overview`

All schemas use strict parameters and disallow extra properties. The registry contains no update,
create, delete, send, adjustment, or restock operation.

## Inventory estimates

Estimated daily usage is:

```text
recorded sale consumption during lookback / lookback calendar days
```

Estimated days remaining is:

```text
current stock / estimated daily usage
```

The estimate is unavailable when there is no recorded sale consumption. It does not account for
supplier lead times or pending purchase orders because those records do not exist yet.

## Conversation and auditing

`agent_conversations` stores:

- Channel
- A SHA-256 hash of the external chat identifier
- OpenAI previous-response identifier
- Language
- Timestamps

`agent_runs` stores:

- Hashed external identifier
- Request identifier
- Model and status
- Input/output character counts
- Tool names, statuses, and durations
- Token usage
- Error code

It does not store customer phone numbers, raw tool results, or complete Telegram conversations.

## Configuration

```env
TELEGRAM_AGENT_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_AGENT_CHAT_IDS=...
TELEGRAM_WEBHOOK_SECRET=...
PUBLIC_BASE_URL=https://api.sightcoffeespace.com
DEFAULT_TIMEZONE=Asia/Riyadh

OPENAI_OPERATIONAL_AGENT_ENABLED=true
OPENAI_API_KEY=...
OPENAI_OPERATIONAL_AGENT_MODEL=gpt-5.6-terra
OPENAI_OPERATIONAL_AGENT_REASONING=medium
```

Keep `OPENAI_API_KEY` on the API service. Never expose it through Vite variables or frontend code.

## Expansion boundary

Future phase 4 actions should use a separate proposal and approval module. Do not add write
functions to the current read-only registry. An approved action should follow:

```text
proposal -> preview -> explicit owner approval -> execution -> audit
```
