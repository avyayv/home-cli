# Setup

## Prerequisites

- Node and pnpm installed
- `pi` installed
- `codex` installed
- local Ollama running at `http://127.0.0.1:11434/v1`
- Upstash Redis database
- Twilio phone number with Messaging enabled
- one or more allowlisted sender phone numbers in E.164 format, comma-separated in `ALLOWED_SMS_FROM`

## Local setup

1. Copy `.env.example` to `.env`
2. Fill in Upstash, Twilio, and phone-number values
3. Create the workspace root directory referenced by `WORKSPACE_ROOT`
4. Install dependencies:

```bash
pnpm install
```

5. Start the runner:

```bash
pnpm dev:runner
```

6. Start the local Twilio dev server if you want to test locally:

```bash
pnpm dev:twilio
```

## Twilio Function

Deploy the handler in `apps/twilio-function/src/handler.ts` as your inbound SMS webhook logic, or run your own thin Node server that forwards the Twilio form payload into that handler.

The webhook must:

- validate `X-Twilio-Signature`
- allow only `ALLOWED_SMS_FROM`
- route plain text into the sender's current job
- answer `/jobs`, `/status`, `/logs`, `/abort`, and `/help` synchronously

## launchd

Use `ops/com.twilio-pi-agent.runner.plist` as the template for auto-start on macOS.
