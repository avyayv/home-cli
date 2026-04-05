# Harness

Twilio/iMessage-style local Pi/Codex runner for a single trusted phone number, now housed under `home-automation/harness`.

## Components

- `apps/twilio-function`: inbound Twilio webhook and outbound SMS helpers
- `apps/mac-runner`: local daemon that polls jobs, runs Pi, and spawns Codex jobs
- `apps/admin-cli`: local utility for enqueueing and inspecting jobs without SMS
- `packages/shared`: schemas, command parsing, queue/state interfaces, and config

## Status

Initial implementation scaffold with shared command model, Redis-backed control plane, runner, and Twilio webhook.
