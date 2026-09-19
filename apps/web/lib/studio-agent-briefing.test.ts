import { describe, expect, it } from "vitest";
import { studioAgentBriefing } from "./studio-agent-briefing";

describe("studioAgentBriefing", () => {
  it("labels heuristic proposals without claiming a model ran", () => {
    const view = studioAgentBriefing({
      patch: {
        id: "p1",
        title: "fix",
        status: "PROPOSED",
        filesChanged: [{ path: "README.md", action: "modify", summary: "note" }],
        evaluationSummary: "heuristic",
        epistemicState: "PROPOSED",
        authorityHint: "LLM_INFERENCE",
      },
      note: "Patch proposed by CODE_ENGINEER heuristic",
      memoryUsed: 3,
      memoryCitations: [
        {
          id: "m1",
          type: "LESSON",
          epistemicState: "CONFIRMED",
          statement: "Prior governed fix on README.md",
        },
      ],
      intelligenceKind: "heuristic",
      modelInvoked: false,
    });
    expect(view.hasPatch).toBe(true);
    expect(view.intelligenceKind).toBe("heuristic");
    expect(view.modelInvoked).toBe(false);
    expect(view.memoryUsed).toBe(3);
    expect(view.citations).toHaveLength(1);
    expect(view.citations[0]?.id).toBe("m1");
    expect(view.files).toEqual([
      { path: "README.md", action: "modify", summary: "note" },
    ]);
    expect(view.epistemicState).toBe("PROPOSED");
    expect(view.authorityHint).toBe("LLM_INFERENCE");
  });

  it("does not invent a patch when ask-agent returned none", () => {
    const view = studioAgentBriefing({
      patch: null,
      note: "No patch",
    });
    expect(view.hasPatch).toBe(false);
    expect(view.intelligenceKind).toBe("unknown");
    expect(view.files).toEqual([]);
    expect(view.memoryUsed).toBe(0);
  });
});
