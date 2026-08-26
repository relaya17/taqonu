import { describe, expect, it } from "vitest";
import { mapGatewayHandoff } from "./atlas-gateway.js";

describe("mapGatewayHandoff", () => {
  it("maps CODE_ENGINEER agent runs to a fabric catalog tool, not fs.read_file", () => {
    expect(mapGatewayHandoff("request_agent_run", "CODE_ENGINEER")).toEqual({
      toolName: "analyze_repo",
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("maps remediation to propose_patch for CODE_ENGINEER", () => {
    expect(mapGatewayHandoff("request_remediation", "CODE_ENGINEER")).toEqual({
      toolName: "propose_patch",
      entityType: "RECORD",
      action: "UPDATE",
    });
  });

  it("falls back to RESEARCHER's first catalog tool instead of a Control Plane alias", () => {
    expect(mapGatewayHandoff("request_agent_run", "RESEARCHER")).toEqual({
      toolName: "knowledge_search",
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("returns null for unknown fabric agents and read-only gateway ops", () => {
    expect(mapGatewayHandoff("request_agent_run", "QA_ENGINEER")).toBeNull();
    expect(mapGatewayHandoff("inspect", "CODE_ENGINEER")).toBeNull();
  });
});
