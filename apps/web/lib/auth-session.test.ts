import { describe, expect, it } from "vitest";
import { SignedOutError, sessionGate } from "./auth-session";

describe("sessionGate", () => {
  it("is checking while the session query is pending", () => {
    expect(sessionGate({ isSuccess: false, isError: false, error: null })).toBe("checking");
  });

  it("is signed-in when the session query succeeded", () => {
    expect(sessionGate({ isSuccess: true, isError: false, error: null })).toBe("signed-in");
  });

  it("is signed-out only when the API explicitly reported no session", () => {
    expect(
      sessionGate({ isSuccess: false, isError: true, error: new SignedOutError() }),
    ).toBe("signed-out");
  });

  it("is unavailable for network and server errors, even with the same message", () => {
    expect(
      sessionGate({ isSuccess: false, isError: true, error: new TypeError("Failed to fetch") }),
    ).toBe("unavailable");
    expect(
      sessionGate({ isSuccess: false, isError: true, error: new Error("Not signed in") }),
    ).toBe("unavailable");
  });
});
