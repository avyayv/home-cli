import "./env.js";
import crypto from "node:crypto";
import process from "node:process";
import {
  ControlPlaneStore,
  createCorrelationId,
  formatJobsList,
  formatJobStatus,
  formatLogResponse,
  getAllowedSmsSenders,
  loadConfig,
  parseSmsCommand
} from "@twilio-pi-agent/shared";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = new ControlPlaneStore(cfg);
  const [verb = "help", ...rest] = process.argv.slice(2);
  const raw = [verb, ...rest].join(" ").trim();
  const sender = process.env.ADMIN_SENDER ?? getAllowedSmsSenders(cfg)[0] ?? cfg.ALLOWED_SMS_FROM;

  if (verb === "enqueue") {
    const task = rest.join(" ").trim();
    const command = parseSmsCommand(task);
    const job = await store.enqueuePrompt({
      sender,
      command,
      receivedAt: new Date().toISOString(),
      correlationId: createCorrelationId("admin")
    });
    console.log(`Queued job #${job.jobNumber} (${job.jobId})`);
    return;
  }

  if (verb === "jobs") {
    const target = rest[0];
    if (target) {
      const jobId = await store.resolveJobId(sender, target);
      if (!jobId) {
        console.log("No job found.");
        return;
      }
      const job = await store.setCurrentJob(sender, jobId);
      if (!job) {
        console.log("No job found.");
        return;
      }
      console.log(`Current job is now #${job.jobNumber}.`);
      return;
    }
    const jobs = await store.listRecentJobs(sender, 24, 10);
    const currentJobId = await store.getCurrentJobId(sender);
    console.log(formatJobsList(jobs, currentJobId));
    return;
  }

  if (verb === "status") {
    const target = rest[0] ?? "latest";
    const jobId = await store.resolveJobId(sender, target);
    if (!jobId) {
      console.log("No job found.");
      return;
    }
    const job = await store.getJob(jobId);
    if (!job) {
      console.log("No job found.");
      return;
    }
    const events = await store.getEvents(jobId, 10);
    console.log(formatJobStatus(job, events));
    return;
  }

  if (verb === "logs") {
    const target = rest[0] ?? "latest";
    const limit = rest[1] ? Number.parseInt(rest[1], 10) : 25;
    const jobId = await store.resolveJobId(sender, target);
    if (!jobId) {
      console.log("No job found.");
      return;
    }
    const job = await store.getJob(jobId);
    if (!job) {
      console.log("No job found.");
      return;
    }
    const events = await store.getEvents(jobId, limit);
    console.log(formatLogResponse(job, events));
    return;
  }

  if (verb === "abort") {
    const target = rest[0] ?? "latest";
    const jobId = await store.resolveJobId(sender, target);
    if (!jobId) {
      console.log("No job found.");
      return;
    }
    const job = await store.getJob(jobId);
    if (!job) {
      console.log("No job found.");
      return;
    }
    job.status = "aborted";
    job.summary = "Aborted by admin command.";
    job.finishedAt = new Date().toISOString();
    await store.saveJob(job);
    await store.appendEvent(job.jobId, {
      eventId: crypto.randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "completion",
      kind: "aborted",
      message: "Job aborted by admin command",
      details: {}
    });
    console.log(`Aborted ${job.jobId}`);
    return;
  }

  console.log("Usage:");
  console.log("  pnpm dev:admin enqueue <task>");
  console.log("  pnpm dev:admin jobs [jobNumber]");
  console.log("  pnpm dev:admin status [jobId|latest]");
  console.log("  pnpm dev:admin logs [jobId|latest] [lines]");
  console.log("  pnpm dev:admin abort [jobId|latest]");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
