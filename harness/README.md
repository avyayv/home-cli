# Harness

Primary local Pi harness for this machine. It receives iMessages from a trusted handle, runs Pi/Codex locally, and can call local CLIs from the monorepo such as `gree`.

## Components

- `apps/imessage-bridge`: local iMessage ingress/egress bridge using Messages.app and the local Messages database
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
- `/logging [seconds] <task>` streams periodic log updates, then sends the final result.
- `/run <task>` starts a separate job instead of continuing the current one.
