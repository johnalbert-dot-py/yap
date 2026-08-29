export type Session =
  | { screen: "workflows" }
  | { screen: "actions"; file: string }
  | { screen: "done" };

export type SessionEvent =
  | { type: "open"; file: string }
  | { type: "back" }
  | { type: "quit" }
  | { type: "ran" }
  | { type: "inspected" }
  | { type: "explained" }
  | { type: "health" };

export const reduceSession = (session: Session, event: SessionEvent): Session => {
  if (event.type === "quit") {
    return { screen: "done" };
  }
  switch (session.screen) {
    case "done":
      return session;
    case "workflows": {
      if (event.type === "open") {
        return { screen: "actions", file: event.file };
      }
      return session;
    }
    case "actions": {
      if (event.type === "back") {
        return { screen: "workflows" };
      }
      if (event.type === "open") {
        return { screen: "actions", file: event.file };
      }
      return session;
    }
    default: {
      const _exhaustive: never = session;
      return _exhaustive;
    }
  }
};
