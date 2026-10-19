import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createDiagnosticSession, parseReport } from "../src/agent.js";
import type { Report } from "../src/schema.js";
import { CASE_IDS, loadCase } from "../src/simulator.js";
import { createDiagnosticTools } from "../src/tools.js";

test("all fixtures are valid and offline Pi loop routes from observed metrics", async () => {
  for (const id of CASE_IDS) {
    const mock = await loadCase(id);
    const session = await createDiagnosticSession(mock, "offline");
    const result = await session.ask(mock.prompt);
    assert.equal(result.report.diagnosis, mock.expectedDiagnosis, id);
    assert.equal(result.trace[0]?.tool, "get_device_metrics", id);
    assert.equal(result.terminated, true, id);
    assert.ok(result.trace.every((step) => step.status === "ok"), id);
    if (id === "healthy") assert.equal(result.toolCalls, 1, "healthy device should stop after metrics");
    if (id === "regression") assert.ok(result.trace.some((step) => step.tool === "get_change_history"));
    if (id === "disk") assert.ok(!result.trace.some((step) => step.tool === "get_top_processes"), "disk evidence should not trigger a GPU/process hunt");
  }
});

test("Pi reports schema-invalid tool arguments as an error observation", async () => {
  const mock = await loadCase("thermal");
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("search_device_logs", { category: "invalid" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done"),
  ]);
  const agent = new Agent({
    initialState: { systemPrompt: "Schema check", model: faux.getModel(), tools: createDiagnosticTools(mock, []) },
    streamFn: models.streamSimple.bind(models),
  });
  const outcomes: boolean[] = [];
  agent.subscribe((event) => { if (event.type === "tool_execution_end") outcomes.push(event.isError); });
  await agent.prompt("Try invalid category");
  assert.deepEqual(outcomes, [true]);
});

test("an in-memory session can handle a second question without reusing old observations", async () => {
  const mock = await loadCase("healthy");
  const session = await createDiagnosticSession(mock, "offline");
  const first = await session.ask(mock.prompt);
  const second = await session.ask("再检查一次当前指标");
  assert.equal(first.sessionId, second.sessionId);
  assert.deepEqual(second.trace.map((step) => step.tool), ["get_device_metrics"]);
});

test("final report parser accepts a fenced JSON answer with a brief preface", () => {
  const report: Report = {
    diagnosis: "healthy", confidence: "high", faultJudgment: "No obvious anomaly.",
    evidence: ["Metrics stable."], observationSummary: "Read metrics and stopped.",
    recommendations: ["Keep monitoring."], needsHumanCheck: false,
  };
  assert.deepEqual(parseReport(`Summary.\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\``), report);
  assert.throws(() => parseReport(JSON.stringify({ ...report, faultJudgment: true })), /report schema/i);
});
