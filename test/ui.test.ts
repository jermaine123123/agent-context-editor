import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import { ContextEditorComponent } from "../adapters/pi-extension/src/ui.js";

function fakeTui(): TUI {
  return {
    terminal: { rows: 16, columns: 80 } as never,
    requestRender: () => undefined,
  } as unknown as TUI;
}

function fakeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
  } as unknown as Theme;
}

describe("ContextEditorComponent", () => {
  it("renders filters and supports search plus view hide without changing atoms", () => {
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "保留目标", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: new Date(20).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "assistant answer" }],
          api: "openai-completions",
          provider: "openai",
          model: "test",
          usage: {},
          stopReason: "stop",
          timestamp: 20,
        } as never,
      },
    ]);
    let saved = 0;
    const component = new ContextEditorComponent(
      fakeTui(),
      fakeTheme(),
      atoms,
      undefined,
      "leaf-1",
      () => {
        saved += 1;
      },
      async () => true,
      () => undefined,
    );

    expect(component.render(80).join("\n")).toContain("Pi Context Editor");
    component.handleInput("f");
    component.handleInput("保留");
    component.handleInput("\r");
    expect(component.render(80).join("\n")).toContain("保留");
    component.handleInput("h");
    expect(saved).toBe(1);
    expect(component.render(80).join("\n")).not.toContain("保留目标");
    expect(atoms[0]?.text).toBe("保留目标");
    component.handleInput("v");
    component.handleInput("r");
    expect(saved).toBe(2);
  });
});
