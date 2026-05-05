# Home Automation CLIs

Collection of standalone home-automation command-line tools.

## CLIs

- [`cli/gree-cli`](cli/gree-cli) — Go CLI binary named `gree` for discovering and controlling GREE HVAC units over the LAN.

## Install GREE CLI

```bash
git clone https://github.com/avyayv/home-automation
cd home-automation/cli/gree-cli
mkdir -p ~/.local/bin
go build -o ~/.local/bin/gree .
chmod +x ~/.local/bin/gree
gree --help
```

## Local development

```bash
cd cli/gree-cli
gofmt -w main.go main_test.go
go test ./...
go build -o gree .
./gree --help
```
