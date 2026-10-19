import { createDiagnosticSession, DiagnosticRunError, type Mode } from "./agent.js";
import { CASE_IDS, loadCase } from "./simulator.js";

const argv = process.argv.slice(2);
const mode: Mode = argv.includes("--live") ? "live" : "offline";
const caseIndex = argv.indexOf("--case");
const ids = caseIndex >= 0 ? [argv[caseIndex + 1] ?? ""] : [...CASE_IDS];

if (mode === "offline") console.error("SCRIPTED OFFLINE HARNESS CHECK: this does not measure LLM diagnosis quality.");
let failures = 0;
for (const id of ids) {
  try {
    const mock = await loadCase(id);
    const session = await createDiagnosticSession(mock, mode);
    const result = await session.ask(mock.prompt);
    const correct = result.report.diagnosis === mock.expectedDiagnosis;
    const stoppedEarly = id === "healthy" ? result.toolCalls <= 2 : null;
    const passed = correct && result.terminated && stoppedEarly !== false;
    if (!passed) failures += 1;
    console.log(JSON.stringify({
      case: id, mode, provider: result.provider, model: result.model, passed, diagnosisMatches: correct, stoppedEarly,
      expectedDiagnosis: mock.expectedDiagnosis, diagnosis: result.report.diagnosis,
      tools: result.trace.map((event) => event.tool), toolCalls: result.toolCalls,
      terminated: result.terminated, sessionId: result.sessionId,
    }));
  } catch (error) {
    failures += 1;
    const runError = error instanceof DiagnosticRunError ? error : undefined;
    console.log(JSON.stringify({ case: id, mode, provider: runError?.provider, model: runError?.model,
      passed: false, diagnosisMatches: false, tools: runError?.trace.map((step) => step.tool) ?? [],
      toolCalls: runError?.trace.length ?? 0, terminated: false,
      error: error instanceof Error ? error.message : String(error) }));
  }
}
process.exitCode = failures ? 1 : 0;
