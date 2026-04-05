# Home Automation

Monorepo for local home automation tools and automation harnesses.

## Layout

- `cli/gree`
  - Python CLI for discovering and controlling GREE HVAC units over the LAN
- `harness`
  - Twilio/iMessage-style local Pi/Codex execution harness running on this Mac

## GREE CLI

The `gree` CLI lives under `cli/gree`.

## Setup

```bash
uv sync --group dev
```

## Usage

```bash
gree devices
gree config init
gree config set-device --mac c039375d1be7
gree status
gree temp 68
gree mode heat
gree fan auto
gree off
gree on
```

`uv run gree ...` and `python -m gree ...` are also supported.

## Device Selection

Selection precedence:

1. Command-line selectors like `--mac` or `--ip`
2. Repo-local config in `cli/gree/gree/config.toml`
3. Automatic selection when exactly one device is discovered

If multiple devices are visible and no selector resolves to exactly one device, the command exits with an error.

## Config

Tracked example:

- `gree/config.example.toml`
  - now at `cli/gree/gree/config.example.toml`

Local working config:

- `gree/config.toml`
  - now at `cli/gree/gree/config.toml`

Create or inspect config with:

```bash
uv run gree config init
uv run gree config show
uv run gree config set scan-wait 2.5
uv run gree config set-device --ip 192.168.1.50
uv run gree config clear-device
```
