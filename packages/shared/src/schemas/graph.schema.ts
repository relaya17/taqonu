import { z } from "zod";
import { GRAPH_EDGE_TYPES, GRAPH_NODE_TYPES } from "../constants/graph.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const graphNodeTypeSchema = z.enum(GRAPH_NODE_TYPES);
export const graphEdgeTypeSchema = z.enum(GRAPH_EDGE_TYPES);

export const graphNodeSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  projectId: uuidSchema.nullable(),
  type: graphNodeTypeSchema,
  key: z.string().min(1).max(500),
  label: z.string().min(1).max(500),
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema,
  evidenceIds: z.array(uuidSchema).default([]),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const graphEdgeSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  projectId: uuidSchema.nullable(),
  type: graphEdgeTypeSchema,
  fromNodeId: uuidSchema,
  toNodeId: uuidSchema,
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema,
  evidenceIds: z.array(uuidSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const graphImpactQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(6).default(3),
  direction: z.enum(["OUT", "IN", "BOTH"]).default("BOTH"),
});

export const graphImpactResultSchema = z.object({
  rootNodeId: uuidSchema,
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  epistemicState: z.enum(["FACT", "INFERRED", "UNKNOWN", "CONFLICTED"]),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphImpactResult = z.infer<typeof graphImpactResultSchema>;
