import { createInterface } from "node:readline/promises";
import { createDiagnosticSession, type Mode } from "./agent.js";
import { loadCase } from "./simulator.js";

const argv = process.argv.slice(2);
const caseIndex = argv.indexOf("--case");
const id = caseIndex >= 0 ? argv[caseIndex + 1] ?? "" : "thermal";
const mode: Mode = argv.includes("--live") ? "live" : "offline";
const mock = await loadCase(id);
const session = await createDiagnosticSession(mock, mode);
if (mode === "offline") console.error("SCRIPTED OFFLINE HARNESS DEMO: tool flow is deterministic; use --live to evaluate model decisions.");

async function show(question: string) {
  const result = await session.ask(question);
  console.log(JSON.stringify({ case: id, mode, provider: result.provider, model: result.model, sessionId: result.sessionId, report: result.report,
    trace: result.trace, toolCalls: result.toolCalls, terminated: result.terminated }, null, 2));
}

if (argv.includes("--interactive")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const question = (await rl.question("诊断问题（空行退出）> ")).trim();
      if (!question) break;
      await show(question);
    }
  } finally { rl.close(); }
} else {
  const questionIndex = argv.indexOf("--question");
  await show(questionIndex >= 0 ? argv[questionIndex + 1] ?? mock.prompt : mock.prompt);
}
