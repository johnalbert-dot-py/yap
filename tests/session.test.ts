import { describe, expect, it } from "vitest";
import { reduceSession, type Session, type SessionEvent } from "../src/cli/session.js";

describe("reduceSession", () => {
  it("opens a file into the action menu", () => {
    expect(
      reduceSession({ screen: "workflows" }, { type: "open", file: "workflows/cars.yaml" }),
    ).toEqual({
      screen: "actions",
      file: "workflows/cars.yaml",
    });
  });

  it("returns to the workflow list on back", () => {
    expect(
      reduceSession({ screen: "actions", file: "workflows/cars.yaml" }, { type: "back" }),
    ).toEqual({
      screen: "workflows",
    });
  });

  it("quits from the workflow list or the action menu", () => {
    expect(reduceSession({ screen: "workflows" }, { type: "quit" })).toEqual({ screen: "done" });
    expect(reduceSession({ screen: "actions", file: "cars.yaml" }, { type: "quit" })).toEqual({
      screen: "done",
    });
  });

  it("stays on the same file after a run", () => {
    const session: Session = { screen: "actions", file: "workflows/cars.yaml" };
    expect(reduceSession(session, { type: "ran" })).toEqual(session);
    expect(reduceSession(session, { type: "inspected" })).toEqual(session);
    expect(reduceSession(session, { type: "explained" })).toEqual(session);
    expect(reduceSession(session, { type: "health" })).toEqual(session);
  });

  it("does not treat create as an actions event", () => {
    const types: SessionEvent["type"][] = [
      "open",
      "back",
      "quit",
      "ran",
      "inspected",
      "explained",
      "health",
    ];
    expect(types).not.toContain("create");
    expect(reduceSession({ screen: "workflows" }, { type: "ran" })).toEqual({
      screen: "workflows",
    });
  });
});
