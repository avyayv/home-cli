# Harness

## Purpose

This directory contains the local Twilio/iMessage-to-Pi execution harness. Inbound messages land on Twilio, state lives in Upstash Redis, and actual execution happens locally on this Mac through the supervised runner in this folder.

## Monorepo Context

This repo is now organized as:

- `cli/gree`
  - Python HVAC CLI
- `harness`
  - Twilio/Pi/Codex harness

The first local automation CLI is `gree`, and it is globally available on this machine.

## Current Architecture

- `twilio-serverless/`
  - Twilio Function ingress for inbound SMS
  - deployed endpoint: `https://twilio-pi-agent-8648-dev.twil.io/inbound-sms`
- `packages/shared/`
  - schemas, config, command parsing, formatting, Redis control-plane store
- `apps/mac-runner/`
  - local runner daemon
  - runs Pi against local Ollama
  - exposes `spawn_codex_job`
- `apps/twilio-function/`
  - local TypeScript version of inbound SMS handling logic
- `apps/admin-cli/`
  - local control/debug CLI

## Runtime Topology

- Twilio receives inbound SMS.
- Twilio Function validates sender and writes commands/jobs into Upstash Redis.
- The local Mac runner polls Redis and executes jobs.
- Pi uses local Ollama at:
  - `http://127.0.0.1:11434/v1`
- Current local model:
  - `gemma4:31b`
- Runner is supervised by macOS `launchd`:
  - agent: `/Users/avyay/Library/LaunchAgents/com.avyay.twilio-pi-agent-runner.plist`
  - stdout log: `/Users/avyay/Library/Logs/twilio-pi-agent-runner.log`
  - stderr log: `/Users/avyay/Library/Logs/twilio-pi-agent-runner.err.log`

## Job Model

- Plain text continues the current job.
- `/run <task>` starts a new job and makes it current.
- `/jobs` lists jobs from the last 24 hours.
- `/jobs <number>` switches the current job.
- `/status`, `/logs`, `/abort`, `/confirm` are control commands.
- Jobs are numbered per sender.
- Multiple jobs can exist in parallel.

## Current Working State

- Fresh jobs complete successfully after the timeout fix.
- Verified live job:
  - `#11` completed successfully
  - workspace: `/Users/avyay/home-automation/harness/workspace/a4a3537b-2686-47c9-9820-c1a922eacdbc`
  - created file: `/Users/avyay/home-automation/harness/workspace/a4a3537b-2686-47c9-9820-c1a922eacdbc/hello.txt`
- The runner is kept alive by `launchd`.

## Important Fixes Applied

- current-job semantics for plain text
- explicit new-job creation with `/run`
- `/jobs` listing and switching
- configurable Pi prompt timeout via `PI_PROMPT_TIMEOUT_MS`, default `300000`
- disabled local provider `reasoning` flag for the Ollama/Gemma path
- hardened Redis event parsing for malformed legacy event records
- `launchd` supervision for the runner

## Machine Access Model

This harness is intentionally allowed to use the local machine outside the per-job workspace when needed.

What is true today:
- each job gets a working directory under `/Users/avyay/home-automation/harness/workspace/<jobId>`
- Pi starts with `cwd` set to that job workspace
- Pi and spawned Codex jobs are not hard-sandboxed to that workspace

This is by design for this machine. Do not assume strict workspace isolation.

## Home Automation CLI

The first local CLI in this monorepo is `gree`.

- global binary:
  - `/Users/avyay/.local/bin/gree`
- source repo location:
  - `/Users/avyay/home-automation/cli/gree`
- repo-local config:
  - `/Users/avyay/home-automation/cli/gree/gree/config.toml`
- example config:
  - `/Users/avyay/home-automation/cli/gree/gree/config.example.toml`

Common commands:

```bash
gree devices
gree status
gree on
gree off
gree mode heat
gree fan auto
gree temp 68
gree config init
gree config show
```

If device selection is ambiguous, inspect:

- `/Users/avyay/home-automation/README.md`
- `/Users/avyay/home-automation/cli/gree/gree/config.toml`
- `/Users/avyay/home-automation/cli/gree/gree/config.example.toml`

## Twilio Notes

- Twilio number:
  - `+18776768809`
- Allowed inbound senders currently configured:
  - `+18777804236`
  - `+15109355552`
- Inbound webhook path is working.
- Outbound toll-free SMS replies still depend on Twilio toll-free verification. Earlier live tests hit Twilio error `30032` before verification.

## Local Operations

Common commands:

```bash
pnpm --dir /Users/avyay/home-automation/harness typecheck
pnpm --dir /Users/avyay/home-automation/harness test
pnpm --dir /Users/avyay/home-automation/harness build
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin jobs
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin status latest
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin logs latest 20
```

Service checks:

```bash
launchctl print gui/$(id -u)/com.avyay.twilio-pi-agent-runner
tail -f /Users/avyay/Library/Logs/twilio-pi-agent-runner.log
```

## Relevant Files

- `/Users/avyay/home-automation/harness/packages/shared/src/commands.ts`
- `/Users/avyay/home-automation/harness/packages/shared/src/config.ts`
- `/Users/avyay/home-automation/harness/packages/shared/src/redis-store.ts`
- `/Users/avyay/home-automation/harness/apps/mac-runner/src/pi-runner.ts`
- `/Users/avyay/home-automation/harness/apps/mac-runner/src/index.ts`
- `/Users/avyay/home-automation/harness/apps/twilio-function/src/handler.ts`
- `/Users/avyay/home-automation/harness/twilio-serverless/functions/inbound-sms.protected.js`
