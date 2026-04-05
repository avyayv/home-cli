# Twilio Function Deployment

This folder contains a deployable Twilio Function for inbound SMS.

## What it does

- accepts inbound SMS from your Twilio number
- allows only configured sender numbers
- writes `run` jobs into Upstash Redis
- serves `status`, `logs`, `abort`, `confirm`, and `help` directly from Redis

## Deploy

1. Install the Twilio CLI and Serverless plugin:

```bash
brew install twilio
twilio plugins:install @twilio-labs/plugin-serverless
```

2. Copy `.env.example` to `.env` in this folder and fill it in.

3. Log in:

```bash
twilio login
```

4. Deploy from this folder:

```bash
twilio serverless:deploy
```

5. After deploy, Twilio prints a domain and Function URL similar to:

```text
https://twilio-pi-agent-1234-dev.twil.io/inbound-sms
```

## Attach the phone number

In the Twilio Console:

1. Open `Phone Numbers`
2. Select `+18776768809`
3. Under `Messaging`
4. Set `A message comes in` to `Webhook`
5. Method: `HTTP POST`
6. URL: your deployed Function URL ending in `/inbound-sms`

## Current env values for this project

- Twilio number: `+18776768809`
- Allowed SMS senders: `+18777804236,+15109355552`

## Notes

- This Function is intentionally self-contained so it can be deployed without bundling the workspace packages.
- Because Twilio hosts the Function, inbound signature validation is not needed inside the Function itself.
