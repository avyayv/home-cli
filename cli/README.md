# gree-cli

Go CLI binary named `gree` for GREE HVAC discovery and control. No Python runtime is required.

## Build

```bash
go build -o gree .
./gree --help
```

## Install

```bash
mkdir -p ~/.local/bin
go build -o ~/.local/bin/gree .
chmod +x ~/.local/bin/gree
gree --help
```

## Examples

```bash
./gree devices
./gree status
./gree temp 68
./gree mode heat
./gree fan auto
./gree off
./gree on
./gree config init
./gree config show
```

All command output is JSON. See the [top-level README](../README.md) for install, update, and config details.
