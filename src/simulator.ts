import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { caseSchema, type MockCase } from "./schema.js";

export const CASE_IDS = ["thermal", "memory", "disk", "regression", "healthy"] as const;
export type CaseId = (typeof CASE_IDS)[number];

/** Only these fixed fixture names can reach the filesystem; user/model input is never used as a path. */
export async function loadCase(id: string): Promise<MockCase> {
  if (!CASE_IDS.some((known) => known === id)) throw new Error(`Unknown case: ${id}`);
  const path = join(process.cwd(), "mock_data", "cases", `${id}.json`);
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Value.Check(caseSchema, raw)) {
    const first = [...Value.Errors(caseSchema, raw)][0];
    throw new Error(`Invalid mock case ${id}: ${first?.message ?? "unknown field"}`);
  }
  return raw as MockCase;
}
