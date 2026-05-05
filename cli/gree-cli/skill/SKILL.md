---
name: gree-cli
description: Guidance for AI agents working with this repository's Go-based GREE HVAC CLI. Use when discovering, reading, configuring, or controlling GREE units over the LAN.
---

# GREE CLI Agent Skill

This repository exposes GREE HVAC discovery and control through `cli/gree-cli/`, a Go CLI binary named `gree`. No Python dependency is required.

## Non-negotiables

- CLI output is always JSON.
- Do not add table, pretty-table, or non-JSON output modes.
- Do not reintroduce Python into `cli/`.
- Run `gofmt` before committing Go changes.
- Update `README.md` and `cli/gree-cli/README.md` when commands change.

## CLI build / install

From repo root:

```bash
cd cli/gree-cli
gofmt -w main.go main_test.go
go test ./...
go build -o gree .
```

Install globally for this user:

```bash
cd cli/gree-cli
gofmt -w main.go main_test.go
go test ./...
go build -o /Users/avyay/.local/bin/gree .
chmod +x /Users/avyay/.local/bin/gree
```

Verify:

```bash
which gree
gree devices
```

## Config

Default config path:

```text
~/.config/gree/config.toml
```

Override with `GREE_CONFIG` when needed.

```bash
gree config init
gree config show
gree config set-device --mac c039375d1be7
gree config set-device --ip 192.168.1.50
gree config set scan-wait 2.5
gree config clear-device
```

Selection precedence:

1. Command flags: `--mac` / `--ip`
2. Saved config
3. Auto-select if exactly one device is discovered

## CLI commands

```bash
gree devices [--scan-wait seconds]
gree status [--mac mac] [--ip ip] [--scan-wait seconds]
gree temp <degrees> [--mac mac] [--ip ip]
gree on [--mac mac] [--ip ip]
gree off [--mac mac] [--ip ip]
gree mode <auto|cool|dry|fan|heat> [--mac mac] [--ip ip]
gree fan <auto|low|medium-low|medium|medium-high|high> [--mac mac] [--ip ip]
gree set temp <degrees>
gree set power <on|off>
gree set mode <auto|cool|dry|fan|heat>
gree set fan <auto|low|medium-low|medium|medium-high|high>
gree update [install_path]
```

## Testing checklist

From `cli/gree-cli/`:

```bash
gofmt -w main.go main_test.go
go test ./...
go build -o gree .
```

Smoke-test against live LAN devices:

```bash
gree devices
gree status
gree temp 68
gree mode heat
gree fan auto
gree off
gree on
```
