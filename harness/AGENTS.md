# Harness

## Purpose

This directory contains the local iMessage-to-Pi execution harness. Inbound messages are read locally from Messages, state lives in Upstash Redis, and actual execution happens locally on this Mac through the supervised runner in this folder.

## Monorepo Context

This repo is now organized as:

- `cli/gree`
  - Python HVAC CLI
- `harness`
  - iMessage/Pi/Codex harness

The first local automation CLI is `gree`, and it is globally available on this machine.

## Current Architecture

- `packages/shared/`
  - schemas, config, command parsing, formatting, Redis control-plane store
- `apps/mac-runner/`
  - local runner daemon
  - runs Pi against local Ollama
  - exposes `spawn_codex_job`
- `apps/imessage-bridge/`
  - local Messages bridge
  - polls the local Messages database for inbound texts
  - sends replies through Messages.app using AppleScript
- `apps/admin-cli/`
  - local control/debug CLI

## Runtime Topology

- Messages.app receives inbound iMessages.
- The local iMessage bridge polls the Messages database and writes commands/jobs into Upstash Redis.
- The local Mac runner polls Redis and executes jobs.
- Pi uses local Ollama at:
  - `http://127.0.0.1:11434/v1`
- Current local model:
  - `gemma4:31b`
- Services are supervised by macOS `launchd`:
  - runner agent: `/Users/avyay/Library/LaunchAgents/com.avyay.imessage-pi-agent-runner.plist`
  - bridge agent: `/Users/avyay/Library/LaunchAgents/com.avyay.imessage-pi-agent-bridge.plist`
  - runner stdout log: `/Users/avyay/Library/Logs/imessage-pi-agent-runner.log`
  - bridge stdout log: `/Users/avyay/Library/Logs/imessage-pi-agent-bridge.out.log`

## Job Model

- Plain text continues the current job.
- `/logging [seconds] <task>` continues the current job and streams log updates before the final result.
- `/run <task>` starts a new job and makes it current.
- `/jobs` lists jobs from the last 24 hours.
- `/jobs <number>` switches the current job.
- `/status`, `/logs`, `/abort`, `/confirm` are control commands.
- Jobs are numbered per iMessage handle.
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
- opt-in incremental log streaming with `/logging [seconds] <task>`
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

## iMessage Notes

- Current trusted handle:
  - `+15109355552`
- The bridge depends on:
  - Messages.app being signed in and working normally
  - Full Disk Access for the terminal/runner so the local Messages database can be read
  - AppleScript automation permission to control Messages.app for outbound replies
- Current database candidates:
  - `/Users/avyay/Library/Messages/chat.db`
  - `/Users/avyay/Library/Group Containers/com.apple.messages/Library/Messages/chat.db`

## Local Operations

Common commands:

```bash
pnpm --dir /Users/avyay/home-automation/harness typecheck
pnpm --dir /Users/avyay/home-automation/harness test
pnpm --dir /Users/avyay/home-automation/harness build
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin jobs
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin status latest
ADMIN_SENDER=+15109355552 pnpm --dir /Users/avyay/home-automation/harness dev:admin logs latest 20
pnpm --dir /Users/avyay/home-automation/harness dev:imessage
```

Service checks:

```bash
launchctl print gui/$(id -u)/com.avyay.imessage-pi-agent-runner
launchctl print gui/$(id -u)/com.avyay.imessage-pi-agent-bridge
tail -f /Users/avyay/Library/Logs/imessage-pi-agent-runner.log
tail -f /Users/avyay/Library/Logs/imessage-pi-agent-bridge.out.log
```

## Relevant Files

- `/Users/avyay/home-automation/harness/packages/shared/src/commands.ts`
- `/Users/avyay/home-automation/harness/packages/shared/src/config.ts`
- `/Users/avyay/home-automation/harness/packages/shared/src/redis-store.ts`
- `/Users/avyay/home-automation/harness/apps/mac-runner/src/pi-runner.ts`
- `/Users/avyay/home-automation/harness/apps/mac-runner/src/index.ts`
- `/Users/avyay/home-automation/harness/apps/imessage-bridge/src/handler.ts`
- `/Users/avyay/home-automation/harness/apps/imessage-bridge/src/imessage.ts`
