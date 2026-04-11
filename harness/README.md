# Harness

Primary local Pi harness for this machine. It receives iMessages from a trusted handle, runs Pi/Codex locally, and can call local CLIs from the monorepo such as `gree`.

## Components

- `apps/imessage-bridge`: local iMessage ingress/egress bridge using Messages.app and the local Messages database
  - `src/index.ts`: bootstrap only
  - `src/bridge-runtime.ts`: polling loop, state checkpointing, Redis handoff, outbound reply orchestration
  - `src/log-stream.ts`: per-job event streaming back to iMessage when logging is enabled
  - `src/handler.ts`: inbound command handling against the shared control plane
  - `src/imessage.ts`: Messages DB access, bridge state persistence, and AppleScript send helpers
- `apps/mac-runner`: local daemon that polls jobs, runs Pi, and spawns Codex jobs
- `apps/admin-cli`: local utility for enqueueing and inspecting jobs without iMessage
- `packages/shared`: schemas, command parsing, queue/state interfaces, and config

## Role In The Monorepo

- `harness` is the main system.
- `cli/` contains standalone tools that the harness can invoke.
- `cli/gree` is only the first CLI, not the center of the repo.

## Status

Shared command model, Redis-backed control plane, supervised Pi runner, and local iMessage bridge.

## Messaging UX

- Plain text waits for the agent result and replies once the job finishes.
- `/logging on` makes that sender receive a message for every job step, then the final result.
- `/logging off` restores the default final-answer-only behavior.
- `/run <task>` starts a separate job instead of continuing the current one.
