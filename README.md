# gree

Repo-local CLI for discovering and controlling GREE HVAC units over the LAN.

## Setup

```bash
uv sync --group dev
```

## Usage

```bash
uv run gree devices
uv run gree config init
uv run gree config set-device --mac c039375d1be7
uv run gree status
uv run gree temp 68
uv run gree mode heat
uv run gree fan auto
uv run gree off
uv run gree on
```

`python -m gree ...` is also supported.

## Device Selection

Selection precedence:

1. Command-line selectors like `--mac` or `--ip`
2. Repo-local config in `gree/config.toml`
3. Automatic selection when exactly one device is discovered

If multiple devices are visible and no selector resolves to exactly one device, the command exits with an error.

## Config

Tracked example:

- `gree/config.example.toml`

Local working config:

- `gree/config.toml`

Create or inspect config with:

```bash
uv run gree config init
uv run gree config show
uv run gree config set scan-wait 2.5
uv run gree config set-device --ip 192.168.1.50
uv run gree config clear-device
```
