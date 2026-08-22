import { describe, expect, it, vi } from "vitest";
import { streamResponse } from "./openai-responses.js";

describe("Responses streaming transport", () => {
  it("parses split SSE frames without changing text or function arguments", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      `data: {"type":"response.created","response":{"id":"resp_stream_1"}}\n\n`,
      `data: {"type":"response.output_text.delta","delta":"Ahoj "}\n\n`,
      `data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\\"objective\\":\\"x\\"}"}\n\n`,
      `data: {"type":"response.function_call_arguments.done","item_id":"item_1","call_id":"call_1","name":"propose_generation_specification","arguments":"{\\"objective\\":\\"x\\"}"}\n\n`,
      `data: {"type":"response.completed","response":{"id":"resp_stream_1"}}\n\n`
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const events = [];
    for await (const event of streamResponse("test-key", { model: "test", store: true })) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "response.created", "response.output_text.delta", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.completed"
    ]);
    expect(events[1]?.delta).toBe("Ahoj ");
    expect(events[3]?.name).toBe("propose_generation_specification");
    expect(events[3]?.arguments).toBe('{"objective":"x"}');
    vi.unstubAllGlobals();
  });
});
