import { Type, type Static } from "typebox";

const percent = Type.Number({ minimum: 0, maximum: 100 });
const nonnegative = Type.Number({ minimum: 0 });
const service = Type.Object({ name: Type.String(), state: Type.Union([Type.Literal("active"), Type.Literal("inactive")]) }, { additionalProperties: false });

export const deviceSchema = Type.Object({
  deviceId: Type.String(), model: Type.String(), l4tVersion: Type.String(),
  firmwareVersion: Type.String(), powerMode: Type.String(), services: Type.Array(service),
}, { additionalProperties: false });
export const metricSampleSchema = Type.Object({
  ageMinutes: nonnegative, inferenceP95Ms: nonnegative, gpuUtilizationPct: percent,
  gpuTemperatureC: Type.Number(), gpuClockMhz: nonnegative, memoryUsedMb: nonnegative,
  memoryTotalMb: Type.Number({ exclusiveMinimum: 0 }), swapUsedMb: nonnegative,
  diskUsedPct: percent, diskFreeGb: nonnegative, cpuUtilizationPct: percent, powerW: nonnegative,
}, { additionalProperties: false });
export const metricsSchema = Type.Object({
  windowMinutes: Type.Number({ exclusiveMinimum: 0 }), samples: Type.Array(metricSampleSchema, { minItems: 1 }),
}, { additionalProperties: false });
export const processSchema = Type.Object({
  pid: Type.Integer({ minimum: 1 }), name: Type.String(), cpuPct: percent,
  memoryMb: nonnegative, memoryGrowthMb15m: Type.Number(), gpuMemoryMb: nonnegative,
}, { additionalProperties: false });
export const logSchema = Type.Object({
  id: Type.String(), ageMinutes: nonnegative,
  category: Type.Union([Type.Literal("thermal"), Type.Literal("memory"), Type.Literal("storage"), Type.Literal("firmware"), Type.Literal("inference")]),
  severity: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]),
  message: Type.String(),
}, { additionalProperties: false });
export const changeSchema = Type.Object({
  id: Type.String(), ageHours: nonnegative, component: Type.String(),
  fromVersion: Type.String(), toVersion: Type.String(), note: Type.String(),
}, { additionalProperties: false });
export const diagnosisSchema = Type.Union([
  Type.Literal("thermal_throttling"), Type.Literal("memory_pressure"),
  Type.Literal("disk_full"), Type.Literal("software_regression"),
  Type.Literal("healthy"), Type.Literal("undetermined"),
]);
export const caseSchema = Type.Object({
  id: Type.String(), prompt: Type.String(), expectedDiagnosis: diagnosisSchema,
  device: deviceSchema, metrics: metricsSchema,
  processes: Type.Array(processSchema), logs: Type.Array(logSchema), changes: Type.Array(changeSchema),
}, { additionalProperties: false });
export const reportSchema = Type.Object({
  diagnosis: diagnosisSchema,
  confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  faultJudgment: Type.String(),
  evidence: Type.Array(Type.String()),
  observationSummary: Type.String(),
  recommendations: Type.Array(Type.String()),
  needsHumanCheck: Type.Boolean(),
}, { additionalProperties: false });

export type MockCase = Static<typeof caseSchema>;
export type Report = Static<typeof reportSchema>;
export type Diagnosis = Static<typeof diagnosisSchema>;
