import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { Value } from "typebox/value";
import { createOfflineModel } from "./offline-model.js";
import { reportSchema, type MockCase, type Report } from "./schema.js";
import { createDiagnosticTools, type ToolTrace } from "./tools.js";

export type Mode = "offline" | "live";
export type DiagnosticResult = { sessionId: string; report: Report; trace: ToolTrace[]; toolCalls: number; terminated: boolean; mode: Mode; provider: string; model: string };
export class DiagnosticRunError extends Error {
  constructor(message: string, readonly trace: ToolTrace[], readonly provider: string, readonly model: string) {
    super(message);
  }
}

export function parseReport(text: string): Report {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const clean = (fenced?.[1] ?? text).trim();
  let value: unknown;
  try { value = JSON.parse(clean); } catch { throw new Error("Model did not return a JSON report"); }
  if (!Value.Check(reportSchema, value)) {
    const first = [...Value.Errors(reportSchema, value)][0];
    throw new Error(`Report schema invalid: ${first?.message ?? "unknown mismatch"}`);
  }
  return value as Report;
}

export async function createDiagnosticSession(mock: MockCase, mode: Mode = "live") {
  const skill = await readFile(join(process.cwd(), "skills", "edge-device-diagnostic", "SKILL.md"), "utf8");
  const systemPrompt = `${skill}\n\nThis session is bound to simulated device ${mock.device.deviceId}. Use tool observations, not fixture labels or expected diagnoses.`;
  const trace: ToolTrace[] = [];
  const tools = createDiagnosticTools(mock, trace);
  const allowed = new Set(tools.map((tool) => tool.name));
  const sessionId = randomUUID();
  let attempted = 0;
  const runtime = mode === "offline" ? createOfflineModel() : (() => {
    const provider = process.env.PI_PROVIDER ?? "openai";
    if (provider !== "openai" && provider !== "deepseek") throw new Error(`Unsupported PI_PROVIDER: ${provider}`);
    const keyName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[keyName]) throw new Error(`${keyName} is required for live mode with ${provider}`);
    const models = createModels();
    models.setProvider(provider === "deepseek" ? deepseekProvider() : openaiProvider());
    const modelName = process.env.PI_MODEL ?? (provider === "deepseek" ? "deepseek-flash" : "gpt-5-mini");
    const model = models.getModel(provider, modelName);
    if (!model) throw new Error(`Unknown ${provider} model in Pi catalog: ${modelName}`);
    return { model, streamFn: models.streamSimple.bind(models) };
  })();
  const agent = new Agent({
    initialState: { systemPrompt, model: runtime.model, thinkingLevel: "off", tools },
    streamFn: runtime.streamFn,
    sessionId,
    toolExecution: "sequential",
    // The hook makes the allowlist explicit even if a future caller changes the tool loadout.
    beforeToolCall: async ({ toolCall }) => {
      attempted += 1;
      if (!allowed.has(toolCall.name)) return { block: true, reason: "Only read-only mock diagnostic tools are allowed" };
      if (attempted > 12) return { block: true, reason: "Diagnostic tool budget exceeded" };
    },
    finishTurn: async () => attempted > 14 ? { action: "end" } : undefined,
  });
  const started = new Map<string, { tool: string; args: unknown }>();
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") started.set(event.toolCallId, { tool: event.toolName, args: event.args });
    if (event.type === "tool_execution_end") {
      const call = started.get(event.toolCallId);
      // Validation and preflight failures never enter execute(), so record their Pi error observation here.
      if (event.isError && !trace.some((item) => item.callId === event.toolCallId)) {
        const content = event.result?.content?.find((item: { type: string }) => item.type === "text")?.text;
        trace.push({ callId: event.toolCallId, tool: call?.tool ?? event.toolName, args: call?.args,
          status: "error", observationSummary: String(content ?? "Tool failed").slice(0, 200) });
      }
      started.delete(event.toolCallId);
    }
  });
  return {
    sessionId,
    async ask(question: string): Promise<DiagnosticResult> {
      attempted = 0;
      const start = trace.length;
      try {
        await agent.prompt(question);
        const getLastText = () => {
          const last = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
          if (!last || last.role !== "assistant") throw new Error("Agent produced no assistant response");
          if (last.stopReason === "error" || last.stopReason === "aborted") throw new Error(last.errorMessage ?? `Agent stopped: ${last.stopReason}`);
          return last.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        };
        let report: Report;
        try {
          report = parseReport(getLastText());
        } catch (error) {
          // A model may wrap JSON in prose or use the wrong field type. Allow one format-only correction.
          const reason = error instanceof Error ? error.message : "Invalid report";
          await agent.prompt(`Your final report failed validation (${reason}). Reformat the same observed evidence. Return only one JSON object, with no prose or Markdown. diagnosis: thermal_throttling | memory_pressure | disk_full | software_regression | healthy | undetermined; confidence: low | medium | high; faultJudgment and observationSummary: strings; evidence and recommendations: arrays of strings; needsHumanCheck: boolean. Do not include private reasoning.`);
          report = parseReport(getLastText());
        }
        const runTrace = trace.slice(start);
        return { sessionId, report, trace: runTrace, toolCalls: runTrace.length, terminated: !agent.state.isStreaming, mode,
          provider: runtime.model.provider, model: runtime.model.id };
      } catch (error) {
        throw new DiagnosticRunError(error instanceof Error ? error.message : String(error), trace.slice(start), runtime.model.provider, runtime.model.id);
      }
    },
  };
}
