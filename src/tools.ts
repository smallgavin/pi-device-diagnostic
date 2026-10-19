import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { changeSchema, deviceSchema, logSchema, metricsSchema, processSchema, type MockCase } from "./schema.js";
import { runbooks, type RunbookTopic } from "./runbooks.js";

const noArgs = Type.Object({}, { additionalProperties: false });
const topicSchema = Type.Union([
  Type.Literal("thermal"), Type.Literal("memory"), Type.Literal("storage"),
  Type.Literal("regression"), Type.Literal("healthy"),
]);
const logArgs = Type.Object({
  category: Type.Optional(Type.Union([
    Type.Literal("all"), Type.Literal("thermal"), Type.Literal("memory"),
    Type.Literal("storage"), Type.Literal("firmware"), Type.Literal("inference"),
  ])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });
const runbookArgs = Type.Object({ topic: topicSchema }, { additionalProperties: false });

export const toolOutputSchemas = {
  get_device_info: Type.Object({ device: deviceSchema }, { additionalProperties: false }),
  get_device_metrics: Type.Object({ deviceId: Type.String(), metrics: metricsSchema }, { additionalProperties: false }),
  get_top_processes: Type.Object({ deviceId: Type.String(), processes: Type.Array(processSchema) }, { additionalProperties: false }),
  search_device_logs: Type.Object({ deviceId: Type.String(), category: Type.String(), logs: Type.Array(logSchema) }, { additionalProperties: false }),
  get_change_history: Type.Object({ deviceId: Type.String(), changes: Type.Array(changeSchema) }, { additionalProperties: false }),
  get_device_runbook: Type.Object({ topic: topicSchema, runbook: Type.Object({ title: Type.String(), checks: Type.Array(Type.String()), recommendations: Type.Array(Type.String()) }, { additionalProperties: false }) }, { additionalProperties: false }),
} as const;

export type ToolTrace = { callId: string; tool: string; args: unknown; status: "ok" | "error"; observationSummary: string };

function summarize(name: string, output: unknown): string {
  const data = output as Record<string, unknown>;
  if (name === "get_device_metrics") {
    const samples = (data.metrics as MockCase["metrics"]).samples;
    const last = samples.at(-1)!;
    return `latency p95 ${last.inferenceP95Ms} ms; GPU ${last.gpuTemperatureC} C / ${last.gpuUtilizationPct}% / ${last.gpuClockMhz} MHz; RAM ${last.memoryUsedMb}/${last.memoryTotalMb} MB; disk ${last.diskUsedPct}%`;
  }
  if (name === "get_top_processes") return `${(data.processes as unknown[]).length} processes`;
  if (name === "search_device_logs") return `${(data.logs as unknown[]).length} matching logs`;
  if (name === "get_change_history") return `${(data.changes as unknown[]).length} changes`;
  if (name === "get_device_runbook") return `runbook ${(data.topic as string)}`;
  return `device ${(data.device as MockCase["device"]).deviceId}`;
}

function readOnlyTool<P extends typeof noArgs | typeof logArgs | typeof runbookArgs>(
  name: keyof typeof toolOutputSchemas,
  description: string,
  parameters: P,
  get: (args: Static<P>) => unknown,
  trace: ToolTrace[],
): AgentTool<P> {
  return {
    name, label: name, description, parameters, outputSchema: toolOutputSchemas[name], executionMode: "sequential",
    execute: async (callId, args) => {
      try {
        const output = get(args);
        if (!Value.Check(toolOutputSchemas[name], output)) throw new Error(`Invalid output from ${name}`);
        trace.push({ callId, tool: name, args, status: "ok", observationSummary: summarize(name, output) });
        return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as AgentToolResult["structuredContent"], details: {} };
      } catch (error) {
        trace.push({ callId, tool: name, args, status: "error", observationSummary: error instanceof Error ? error.message : "Unknown tool error" });
        throw error;
      }
    },
  };
}

/** This is the complete executable capability set. No shell, filesystem or device action is exposed. */
export function createDiagnosticTools(mock: MockCase, trace: ToolTrace[]): AgentTool[] {
  return [
    readOnlyTool("get_device_info", "Read simulated device identity, software versions, power mode and service states.", noArgs, () => ({ device: mock.device }), trace),
    readOnlyTool("get_device_metrics", "Read the simulated 15-minute inference, GPU, thermal, memory, storage, CPU and power trend.", noArgs, () => ({ deviceId: mock.device.deviceId, metrics: mock.metrics }), trace),
    readOnlyTool("get_top_processes", "Read simulated process CPU, RAM growth and GPU memory use.", noArgs, () => ({ deviceId: mock.device.deviceId, processes: mock.processes }), trace),
    readOnlyTool("search_device_logs", "Search simulated logs by category; use all when the cause is unclear.", logArgs, (args) => ({ deviceId: mock.device.deviceId, category: args.category ?? "all", logs: mock.logs.filter((log) => !args.category || args.category === "all" || log.category === args.category).slice(0, args.limit ?? 20) }), trace),
    readOnlyTool("get_change_history", "Read recent simulated firmware and software changes.", noArgs, () => ({ deviceId: mock.device.deviceId, changes: mock.changes }), trace),
    readOnlyTool("get_device_runbook", "Read concise troubleshooting guidance for one suspected diagnosis.", runbookArgs, (args) => ({ topic: args.topic, runbook: runbooks[args.topic as RunbookTopic] }), trace),
  ];
}
