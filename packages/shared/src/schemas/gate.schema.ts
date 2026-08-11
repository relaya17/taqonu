import { z } from "zod";
import { GATE_STATUSES } from "../constants/gates.js";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const gateStatusSchema = z.enum(GATE_STATUSES);

export const qualityGateNodeSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  status: gateStatusSchema,
  blockerReason: z.string().max(2000).nullable(),
  evidenceIds: z.array(uuidSchema).default([]),
  waivedBy: z.string().max(200).nullable().default(null),
  waivedReason: z.string().max(2000).nullable().default(null),
  updatedAt: isoDateTimeSchema,
});

export const qualityGateEdgeSchema = z.object({
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
});

/** Release readiness DAG — not a single health %. */
export const qualityGateGraphSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  name: z.string().min(1).max(200),
  nodes: z.array(qualityGateNodeSchema).min(1),
  edges: z.array(qualityGateEdgeSchema).default([]),
  plainLanguageSummary: z.string().max(4000),
  evaluatedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const evaluateGatesRequestSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
});

export const waiveGateSchema = z.object({
  gateId: z.string().min(1).max(120),
  waivedBy: z.string().min(1).max(200),
  reason: z.string().min(3).max(2000),
});

export type QualityGateNode = z.infer<typeof qualityGateNodeSchema>;
export type QualityGateEdge = z.infer<typeof qualityGateEdgeSchema>;
export type QualityGateGraph = z.infer<typeof qualityGateGraphSchema>;
