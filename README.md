# Home CLI

Collection of standalone home command-line tools.

## CLIs

- [`cli/gree-cli`](cli/gree-cli) — Go CLI binary named `gree` for discovering and controlling GREE HVAC units over the LAN.
- [`cli/oura-ring-cli`](cli/oura-ring-cli) — Go CLI binary named `oura` for querying the Oura Ring API.

## Install GREE CLI

```bash
git clone https://github.com/avyayv/home-cli
cd home-cli/cli/gree-cli
mkdir -p ~/.local/bin
go build -o ~/.local/bin/gree .
chmod +x ~/.local/bin/gree
gree --help
```

## Install Oura Ring CLI

```bash
git clone https://github.com/avyayv/home-cli
cd home-cli/cli/oura-ring-cli
mkdir -p ~/.local/bin
go build -o ~/.local/bin/oura .
chmod +x ~/.local/bin/oura
oura --help
```

Create an Oura personal access token at https://cloud.ouraring.com/personal-access-tokens, then set `OURA_TOKEN` or run `oura config set-token <token>`.

## Local development

```bash
cd cli/gree-cli
gofmt -w main.go main_test.go
go test ./...
go build -o gree .
./gree --help

cd ../oura-ring-cli
gofmt -w main.go main_test.go
go test ./...
go build -o oura .
./oura --help
```
