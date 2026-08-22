import { describe, expect, it } from "vitest";
import { appendDiscussionTextDelta, createDiscussionTextStream, finishDiscussionTextStream } from "./generation-discussion.js";

describe("OWNER discussion text stream", () => {
  it("streams normal assistant text without a snapshot reload", () => {
    let state = createDiscussionTextStream();
    const first = appendDiscussionTextDelta(state, "Normální ");
    state = first.state;
    const second = appendDiscussionTextDelta(state, "odpověď.");
    expect(first.visibleDelta).toBe("Normální ");
    expect(second.visibleDelta).toBe("odpověď.");
    expect(finishDiscussionTextStream(second.state)).toEqual({ content: "Normální odpověď.", visibleDelta: "" });
  });

  it("rejects legacy raw JSON instead of extracting assistantMessage as OWNER text", () => {
    const first = appendDiscussionTextDelta(createDiscussionTextStream(), '{"assistantMessage":"Nikdy nezobrazuj"}');
    const finished = finishDiscussionTextStream(first.state);
    expect(first.visibleDelta).toBe("");
    expect(finished.content).not.toContain("assistantMessage");
    expect(finished.content).not.toContain("Nikdy nezobrazuj");
    expect(finished.content).toContain("textovém formátu");
  });

  it("holds a split fenced JSON prefix before it can reach the OWNER", () => {
    const first = appendDiscussionTextDelta(createDiscussionTextStream(), "```js");
    const second = appendDiscussionTextDelta(first.state, "on\n{}");
    expect(first.visibleDelta).toBe("");
    expect(second.visibleDelta).toBe("");
    expect(finishDiscussionTextStream(second.state).content).not.toContain("```json");
  });
});
