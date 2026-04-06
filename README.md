# Home Automation

Monorepo for local home automation tools and the Mac-hosted agent harness that drives them.

## Layout

- `cli/gree`
  - standalone Python CLI for discovering and controlling GREE HVAC units over the LAN
- `harness`
  - local iMessage-to-Pi/Codex harness running on this Mac

## Quick Start

```bash
uv sync --group dev
```

The primary CLI is available as:

```bash
gree --help
```

## Docs

- GREE CLI usage and configuration: [cli/gree/README.md](/Users/avyay/home-automation/cli/gree/README.md)
- Harness architecture and messaging flow: [harness/README.md](/Users/avyay/home-automation/harness/README.md)
- Harness setup details: [harness/docs/SETUP.md](/Users/avyay/home-automation/harness/docs/SETUP.md)
