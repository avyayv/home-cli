# Harness

Local iMessage-to-Pi/Codex runner for a single trusted handle, housed under `home-automation/harness`.

## Components

- `apps/imessage-bridge`: local iMessage ingress/egress bridge using Messages.app and the local Messages database
- `apps/mac-runner`: local daemon that polls jobs, runs Pi, and spawns Codex jobs
- `apps/admin-cli`: local utility for enqueueing and inspecting jobs without iMessage
- `packages/shared`: schemas, command parsing, queue/state interfaces, and config

## Status

Shared command model, Redis-backed control plane, supervised Pi runner, and local iMessage bridge.

## Messaging UX

- Plain text waits for the agent result and replies once the job finishes.
- `/logging [seconds] <task>` streams periodic log updates, then sends the final result.
- `/run <task>` starts a separate job instead of continuing the current one.
