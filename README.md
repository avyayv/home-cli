# Home Automation

Monorepo for a Mac-hosted Pi harness plus local home automation CLIs.

## Layout

- `harness`
  - primary local iMessage-to-Pi/Codex harness running on this Mac
- `cli/`
  - standalone automation CLIs that the harness can call
- `cli/gree`
  - first CLI: GREE HVAC discovery and control over the LAN

## Quick Start

```bash
uv sync --group dev
```

Main local agent system:

```bash
cd harness
pnpm dev:runner
pnpm dev:imessage
```

## Docs

- Harness overview and messaging flow: [harness/README.md](/Users/avyay/home-automation/harness/README.md)
- Harness setup details: [harness/docs/SETUP.md](/Users/avyay/home-automation/harness/docs/SETUP.md)
- GREE CLI usage and configuration: [cli/gree/README.md](/Users/avyay/home-automation/cli/gree/README.md)
