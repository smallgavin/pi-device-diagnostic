import { createModels, type TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { MockCase, Report } from "./schema.js";

type Observation = Record<string, unknown>;

function observations(context: TranscriptContext): Map<string, Observation> {
  const found = new Map<string, Observation>();
  const latestUser = context.messages.findLastIndex((message) => message.role === "user");
  for (const message of context.messages.slice(latestUser + 1)) {
    if (message.role !== "toolResult" || message.isError) continue;
    const block = message.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") continue;
    try { found.set(message.toolName, JSON.parse(block.text) as Observation); } catch { /* malformed result is handled by the agent */ }
  }
  return found;
}

/** A deterministic observation consumer for offline harness checks, never used as the live diagnostic model. */
export function createOfflineModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const reply = (context: TranscriptContext) => {
    const seen = observations(context);
    const call = (name: string, args: Record<string, string> = {}) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
    if (!seen.has("get_device_metrics")) return call("get_device_metrics");
    const metrics = seen.get("get_device_metrics")!.metrics as MockCase["metrics"];
    const last = metrics.samples.at(-1)!;
    const first = metrics.samples[0]!;
    const memoryPct = 100 * last.memoryUsedMb / last.memoryTotalMb;
    let diagnosis: Report["diagnosis"] = "healthy";
    let topic: "thermal" | "memory" | "storage" | "regression" | "healthy" = "healthy";
    if (last.gpuTemperatureC >= 85 && last.gpuClockMhz < first.gpuClockMhz) {
      diagnosis = "thermal_throttling"; topic = "thermal";
      if (!seen.has("get_top_processes")) return call("get_top_processes");
      if (!seen.has("search_device_logs")) return call("search_device_logs", { category: "thermal" });
    } else if (memoryPct >= 95) {
      diagnosis = "memory_pressure"; topic = "memory";
      if (!seen.has("get_top_processes")) return call("get_top_processes");
      if (!seen.has("search_device_logs")) return call("search_device_logs", { category: "memory" });
    } else if (last.diskUsedPct >= 98) {
      diagnosis = "disk_full"; topic = "storage";
      if (!seen.has("search_device_logs")) return call("search_device_logs", { category: "storage" });
    } else if (last.inferenceP95Ms >= 90) {
      if (!seen.has("get_change_history")) return call("get_change_history");
      const changes = seen.get("get_change_history")!.changes as MockCase["changes"];
      diagnosis = changes.length ? "software_regression" : "undetermined";
      topic = "regression";
      if (!seen.has("search_device_logs")) return call("search_device_logs", { category: "inference" });
    }
    if (diagnosis !== "healthy" && !seen.has("get_device_runbook")) return call("get_device_runbook", { topic });
    const log = ((seen.get("search_device_logs")?.logs ?? []) as MockCase["logs"])[0];
    const process = ((seen.get("get_top_processes")?.processes ?? []) as MockCase["processes"])[0];
    const changes = (seen.get("get_change_history")?.changes ?? []) as MockCase["changes"];
    const runbook = seen.get("get_device_runbook")?.runbook as { recommendations: string[] } | undefined;
    const evidence = [
      `p95 latency ${first.inferenceP95Ms} -> ${last.inferenceP95Ms} ms; GPU ${last.gpuTemperatureC} C, ${last.gpuUtilizationPct}% and ${last.gpuClockMhz} MHz; RAM ${last.memoryUsedMb}/${last.memoryTotalMb} MB; disk ${last.diskUsedPct}%.`,
    ];
    if (process) evidence.push(`Process ${process.name} pid ${process.pid}: ${process.memoryMb} MB, 15-minute growth ${process.memoryGrowthMb15m} MB.`);
    if (log) evidence.push(`Log ${log.id}: ${log.message}`);
    if (changes.length) evidence.push(...changes.map((change) => `Change ${change.id}: ${change.component} ${change.fromVersion} -> ${change.toVersion}; ${change.note}`));
    const report: Report = {
      diagnosis,
      confidence: diagnosis === "software_regression" || diagnosis === "undetermined" ? "medium" : "high",
      faultJudgment: {
        thermal_throttling: "Sustained heat and falling GPU clock align with thermal throttling.",
        memory_pressure: "Rising RAM and swap with OOM evidence align with memory pressure.",
        disk_full: "Nearly full storage and write failures explain the slowdown.",
        software_regression: "Latency increase aligns with recent updates; the exact changed component remains unisolated.",
        healthy: "No obvious anomaly in the sampled window.",
        undetermined: "The current observations do not identify one cause.",
      }[diagnosis],
      evidence,
      observationSummary: `Read ${[...seen.keys()].join(" -> ")}; stopped after the available observations supported ${diagnosis}.`,
      recommendations: runbook?.recommendations ?? ["Continue monitoring against this baseline."],
      needsHumanCheck: diagnosis !== "healthy",
    };
    return fauxAssistantMessage(JSON.stringify(report));
  };
  faux.setResponses(Array.from({ length: 128 }, () => reply));
  return { model: faux.getModel(), streamFn: models.streamSimple.bind(models), providerCalls: () => faux.state.callCount };
}
