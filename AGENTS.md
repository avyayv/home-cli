# Home Automation Monorepo

## Layout

- `cli/gree`
  - Python CLI for discovering and controlling GREE HVAC units over the LAN
- `harness`
  - Twilio/iMessage-to-Pi local execution harness

## GREE

- Global CLI command:
  - `gree`
- Source lives in:
  - `/Users/avyay/home-automation/cli/gree`
- Repo-local config lives in:
  - `/Users/avyay/home-automation/cli/gree/gree/config.toml`

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

## Harness

- Source lives in:
  - `/Users/avyay/home-automation/harness`
- Runner workspace root:
  - `/Users/avyay/home-automation/harness/workspace`
- Local model endpoint:
  - `http://127.0.0.1:11434/v1`
- Current local model:
  - `gemma4:31b`

The harness runner is supervised by macOS `launchd` using:

- `/Users/avyay/Library/LaunchAgents/com.avyay.twilio-pi-agent-runner.plist`

## Operational Notes

- The harness is intended to be able to act outside its per-job workspace when needed.
- Pi jobs launched through the harness get an `AGENTS.md` placed into their workspace so they know about `gree` and the local machine setup.
- For harness-specific implementation details, read:
  - `/Users/avyay/home-automation/harness/AGENTS.md`
