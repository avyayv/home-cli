# Setup

## Requirements

- Messages.app signed in and working on this Mac
- Upstash Redis credentials
- one or more allowlisted iMessage handles in `ALLOWED_IMESSAGE_HANDLES`
- Full Disk Access for the terminal and any `launchd`-managed bridge process so the local Messages database can be read
- Automation permission for the bridge to control Messages.app via AppleScript

## Environment

1. Copy `.env.example` to `.env`
2. Fill in:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `ALLOWED_IMESSAGE_HANDLES`
3. Keep or adjust:
   - `IMESSAGE_DB_PATH`
   - `IMESSAGE_STATE_PATH`
   - `IMESSAGE_POLL_INTERVAL_MS`
   - `IMESSAGE_LOG_INTERVAL_MS`
   - `IMESSAGE_LOG_LINES_PER_UPDATE`
   - `IMESSAGE_SERVICE_ID` if you want to pin the Messages service explicitly

## Local Dev

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev:runner
pnpm dev:imessage
```

## macOS Permissions

Grant Full Disk Access to the terminal app you use for local testing and to any background service host if needed. Without this, the bridge will not be able to read the Messages database.

Grant Automation permission when macOS prompts to allow the bridge to control `Messages.app`. Without this, outbound replies cannot be sent.

## launchd

Use these templates:

- `ops/com.imessage-pi-agent.runner.plist`
- `ops/com.imessage-pi-agent.bridge.plist`

They run:

- `pnpm --dir /Users/avyay/home-automation/harness dev:runner`
- `pnpm --dir /Users/avyay/home-automation/harness dev:imessage`

## Admin CLI

Examples:

```bash
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin jobs
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin status latest
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin logs latest 20
```

## iMessage Commands

- Plain text continues the current job and waits for the final answer.
- `/logging [seconds] <task>` continues the current job and sends periodic log updates.
- `/run <task>` starts a new job.
- `/jobs`, `/status`, `/logs`, `/abort`, and `/confirm` remain control commands.
