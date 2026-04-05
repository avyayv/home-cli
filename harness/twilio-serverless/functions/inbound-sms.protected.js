function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`;
}

function parseCommand(body) {
  const trimmed = (body || "").trim();
  if (!trimmed) {
    return { type: "help", rawText: "help" };
  }

  if (!trimmed.startsWith("/")) {
    return { type: "run", rawText: trimmed, task: trimmed, newJob: false };
  }

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase().replace(/^\//, "");
  const rest = parts.slice(1);
  const restText = rest.join(" ").trim();

  switch (verb) {
    case "run":
      return { type: "run", rawText: trimmed, task: restText, newJob: true };
    case "status":
      return { type: "status", rawText: trimmed, target: restText || "latest" };
    case "logs":
      return {
        type: "logs",
        rawText: trimmed,
        target: rest[0] || "latest",
        lines: Number.isFinite(Number.parseInt(rest[1], 10)) ? Number.parseInt(rest[1], 10) : 25
      };
    case "abort":
      return { type: "abort", rawText: trimmed, target: restText || "latest" };
    case "confirm":
      return { type: "confirm", rawText: trimmed, token: restText };
    case "help":
      return { type: "help", rawText: trimmed };
    case "jobs":
      return { type: "jobs", rawText: trimmed, target: restText || undefined };
    default:
      return { type: "help", rawText: trimmed };
  }
}

function buildHelpText() {
  return [
    "Commands:",
    "/run <task>  start a new job",
    "/status <jobId|latest>",
    "/logs <jobId|latest> [lines]",
    "/abort <jobId|latest>",
    "/confirm <token>",
    "/jobs [jobNumber]",
    "/help",
    "",
    "Plain text goes to the current job."
  ].join("\n");
}

function getAllowedSenders(context) {
  return String(context.ALLOWED_SMS_FROM || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function redisHeaders(context) {
  return {
    Authorization: `Bearer ${context.UPSTASH_REDIS_REST_TOKEN}`
  };
}

async function redisGet(context, key) {
  const url = `${context.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, { headers: redisHeaders(context) });
  const data = await response.json();
  return data.result || null;
}

async function redisSet(context, key, value) {
  const response = await fetch(`${context.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      ...redisHeaders(context),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });
  return response.json();
}

async function redisPush(context, key, value) {
  const response = await fetch(`${context.UPSTASH_REDIS_REST_URL}/rpush/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      ...redisHeaders(context),
      "Content-Type": "application/json"
    },
    body: JSON.stringify([value])
  });
  return response.json();
}

async function redisRange(context, key, start, end) {
  const response = await fetch(
    `${context.UPSTASH_REDIS_REST_URL}/lrange/${encodeURIComponent(key)}/${start}/${end}`,
    { headers: redisHeaders(context) }
  );
  const data = await response.json();
  return data.result || [];
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function parseJob(raw) {
  if (!raw) return null;
  try {
    const job = JSON.parse(raw);
    if (!job || typeof job.jobId !== "string" || !Number.isInteger(job.jobNumber) || job.jobNumber <= 0) {
      return null;
    }
    if (!Array.isArray(job.promptQueue)) {
      job.promptQueue = [];
    }
    return job;
  } catch {
    return null;
  }
}

function latestKey(context, sender) {
  return `${context.LATEST_JOB_KEY_PREFIX}${sender}`;
}

function currentKey(context, sender) {
  return `${context.CURRENT_JOB_KEY_PREFIX}${sender}`;
}

function senderJobsKey(context, sender) {
  return `${context.SENDER_JOBS_KEY_PREFIX}${sender}`;
}

function nextJobNumberKey(context, sender) {
  return `${context.NEXT_JOB_NUMBER_KEY_PREFIX}${sender}`;
}

function jobKey(context, jobId) {
  return `${context.JOB_KEY_PREFIX}${jobId}`;
}

function eventKey(context, jobId) {
  return `${context.EVENT_KEY_PREFIX}${jobId}`;
}

function requiresConfirmation(task) {
  return [
    /\brm\b/i,
    /\bgit\s+reset\b/i,
    /\bgit\s+clean\b/i,
    /\bbrew\s+install\b/i,
    /\bnpm\s+publish\b/i,
    /\bdeploy\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i
  ].some((pattern) => pattern.test(task || ""));
}

async function appendEvent(context, jobId, event) {
  await redisPush(context, eventKey(context, jobId), JSON.stringify(event));
}

async function resolveJobId(context, sender, target) {
  if (target === "latest") {
    return redisGet(context, latestKey(context, sender));
  }
  if (/^\d+$/.test(String(target))) {
    const ids = await redisRange(context, senderJobsKey(context, sender), 0, 49);
    for (const id of ids) {
      const rawJob = await redisGet(context, jobKey(context, id));
      if (!rawJob) continue;
      const job = parseJob(rawJob);
      if (!job) continue;
      if (job.jobNumber === Number.parseInt(target, 10)) return id;
    }
    return null;
  }
  return target;
}

exports.handler = async function handler(context, event, callback) {
  try {
    const from = String(event.From || "").trim();
    const body = String(event.Body || "").trim();
    const allowedSenders = getAllowedSenders(context);

    if (!allowedSenders.includes(from)) {
      callback(null, twiml("Unauthorized."));
      return;
    }

    const command = parseCommand(body);

    if (command.type === "help") {
      callback(null, twiml(buildHelpText()));
      return;
    }

    if (command.type === "jobs") {
      if (command.target) {
        const jobId = await resolveJobId(context, from, command.target);
        if (!jobId) {
          callback(null, twiml("No job found."));
          return;
        }
        const rawJob = await redisGet(context, jobKey(context, jobId));
        const job = parseJob(rawJob);
        if (!job) {
          callback(null, twiml("No job found."));
          return;
        }
        await redisSet(context, currentKey(context, from), jobId);
        await redisSet(context, latestKey(context, from), jobId);
        callback(null, twiml(`Current job is now #${job.jobNumber}.`));
        return;
      }
      const currentJobId = await redisGet(context, currentKey(context, from));
      const ids = await redisRange(context, senderJobsKey(context, from), 0, 9);
      const lines = [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const id of ids) {
        const rawJob = await redisGet(context, jobKey(context, id));
        const job = parseJob(rawJob);
        if (!job) continue;
        if (new Date(job.createdAt).getTime() < cutoff) continue;
        lines.push(`${id === currentJobId ? "*" : " "}#${job.jobNumber} ${job.status} ${job.summary}`.trim());
      }
      callback(null, twiml(lines.length ? lines.join("\n") : "No jobs in the last 24 hours."));
      return;
    }

    if (command.type === "confirm") {
      const latestJobId = await redisGet(context, currentKey(context, from));
      if (!latestJobId) {
        callback(null, twiml("No pending job matched that token."));
        return;
      }
      const rawJob = await redisGet(context, jobKey(context, latestJobId));
      const job = parseJob(rawJob);
      if (!job || job.confirmationToken !== command.token || job.status !== "awaiting_confirmation") {
        callback(null, twiml("No pending job matched that token."));
        return;
      }

      job.status = "queued";
      job.summary = "Confirmed and queued";
      job.requiresConfirmation = false;
      job.confirmationToken = undefined;
      job.confirmationRequestedAt = undefined;
      await redisSet(context, jobKey(context, job.jobId), JSON.stringify(job));
      await redisPush(context, context.JOB_QUEUE_KEY, job.jobId);
      await appendEvent(context, job.jobId, {
        eventId: randomId("evt"),
        jobId: job.jobId,
        timestamp: nowIso(),
        phase: "confirmation",
        kind: "queued",
        message: "Confirmation received; job queued",
        details: {}
      });
      callback(null, twiml(`Confirmed ${job.jobId.slice(0, 8)}. Job queued.`));
      return;
    }

    const resolvedJobId = await resolveJobId(context, from, command.target || "latest");
    if (!resolvedJobId) {
      callback(null, twiml("No job found."));
      return;
    }

    const rawJob = await redisGet(context, jobKey(context, resolvedJobId));
    const job = parseJob(rawJob);
    if (!job) {
      callback(null, twiml("No job found."));
      return;
    }

    if (command.type === "status") {
      const rawEvents = await redisRange(context, eventKey(context, resolvedJobId), -10, -1);
      const parsedEvents = rawEvents.map((item) => JSON.parse(item));
      const latest = parsedEvents.at(-1);
      const message = `Job ${job.jobId.slice(0, 8)} is ${job.status}.${latest ? ` Latest: ${latest.message}` : ""}`;
      callback(null, twiml(message.trim()));
      return;
    }

    if (command.type === "logs") {
      const rawEvents = await redisRange(context, eventKey(context, resolvedJobId), -Math.max(1, command.lines || 25), -1);
      const chunks = rawEvents
        .map((item) => JSON.parse(item))
        .flatMap((item) => [item.stdoutChunk, item.stderrChunk].filter(Boolean))
        .slice(-5);
      if (chunks.length === 0) {
        callback(null, twiml(`No logs yet for ${job.jobId.slice(0, 8)}.`));
        return;
      }
      callback(null, twiml([`Logs for ${job.jobId.slice(0, 8)}:`, ...chunks].join("\n")));
      return;
    }

    if (command.type === "abort") {
      job.status = "aborted";
      job.summary = "Aborted by SMS command.";
      job.finishedAt = nowIso();
      await redisSet(context, jobKey(context, resolvedJobId), JSON.stringify(job));
      await appendEvent(context, job.jobId, {
        eventId: randomId("evt"),
        jobId: job.jobId,
        timestamp: nowIso(),
        phase: "completion",
        kind: "aborted",
        message: "Job aborted by user",
        details: {}
      });
      callback(null, twiml(`Aborted ${job.jobId.slice(0, 8)}.`));
      return;
    }

    if (command.type === "run") {
      const currentJobId = await redisGet(context, currentKey(context, from));
      const existingRawJob = currentJobId ? await redisGet(context, jobKey(context, currentJobId)) : null;
      const existingJob = parseJob(existingRawJob);

      if (existingJob && !command.newJob) {
        existingJob.command = command;
        existingJob.promptQueue = Array.isArray(existingJob.promptQueue) ? existingJob.promptQueue : [];
        existingJob.promptQueue.push(command.task);
        existingJob.summary = existingJob.status === "running" ? "Queued follow-up prompt" : "Queued";
        existingJob.finishedAt = undefined;
        if (!["running", "queued", "awaiting_confirmation"].includes(existingJob.status)) {
          existingJob.status = "queued";
          await redisPush(context, context.JOB_QUEUE_KEY, existingJob.jobId);
        }
        await redisSet(context, jobKey(context, existingJob.jobId), JSON.stringify(existingJob));
        await redisSet(context, latestKey(context, from), existingJob.jobId);
        await appendEvent(context, existingJob.jobId, {
          eventId: randomId("evt"),
          jobId: existingJob.jobId,
          timestamp: nowIso(),
          phase: "queue",
          kind: "queued",
          message: `Prompt queued for job #${existingJob.jobNumber}`,
          details: { prompt: command.task }
        });
        callback(null, twiml(`Queued for job #${existingJob.jobNumber}.`));
        return;
      }

      const jobId = randomId("job");
      const createdAt = nowIso();
      const dangerous = requiresConfirmation(command.task);
      const confirmationToken = dangerous ? Math.random().toString(36).slice(2, 8) : undefined;
      const jobNumberRaw = await fetch(`${context.UPSTASH_REDIS_REST_URL}/incr/${encodeURIComponent(nextJobNumberKey(context, from))}`, {
        method: "POST",
        headers: redisHeaders(context)
      });
      const jobNumber = (await jobNumberRaw.json()).result;
      const job = {
        jobId,
        jobNumber,
        source: "sms",
        sender: from,
        command,
        status: dangerous ? "awaiting_confirmation" : "queued",
        summary: dangerous ? "Awaiting confirmation" : "Queued",
        requiresConfirmation: dangerous,
        confirmationToken,
        confirmationRequestedAt: dangerous ? createdAt : undefined,
        workspaceRoot: context.WORKSPACE_ROOT,
        promptQueue: [command.task],
        createdAt,
        correlationId: randomId("sms")
      };
      await redisSet(context, jobKey(context, jobId), JSON.stringify(job));
      await redisSet(context, latestKey(context, from), jobId);
      await redisSet(context, currentKey(context, from), jobId);
      await redisPush(context, senderJobsKey(context, from), jobId);
      if (!dangerous) await redisPush(context, context.JOB_QUEUE_KEY, jobId);
      await appendEvent(context, jobId, {
        eventId: randomId("evt"),
        jobId,
        timestamp: createdAt,
        phase: dangerous ? "confirmation" : "queue",
        kind: dangerous ? "waiting_confirmation" : "queued",
        message: dangerous ? `Job #${jobNumber} awaiting confirmation` : `Job #${jobNumber} queued`,
        details: { confirmationToken }
      });
      const message = dangerous
        ? `Queued for job #${jobNumber}. Reply /confirm ${confirmationToken} to run it.`
        : `Queued for job #${jobNumber}.`;
      callback(null, twiml(message));
      return;
    }

    callback(null, twiml(buildHelpText()));
  } catch (error) {
    callback(error);
  }
};
