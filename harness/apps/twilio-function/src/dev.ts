import "./env.js";
import http from "node:http";
import { handleInboundSms } from "./handler.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method not allowed");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  try {
    const xml = await handleInboundSms({
      url: `http://localhost:${port}${req.url ?? "/"}`,
      headers: req.headers as Record<string, string | undefined>,
      body: Object.fromEntries(body.entries())
    });
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" }).end(xml);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

server.listen(port, () => {
  console.log(`Twilio dev server listening on http://localhost:${port}`);
});
