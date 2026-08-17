import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPiText, detectPiLocale } from "../adapters/pi-extension/src/locale.js";
import { createHarnessText, detectHarnessLocale } from "../adapters/deepseek-harness/locale.js";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe("system locale routing", () => {
  it("keeps Chinese locales in Chinese and routes other locales to English", () => {
    expect(detectPiLocale({ navigator: { language: "zh-CN" } })).toBe("zh");
    expect(detectPiLocale({ navigator: { languages: ["ja-JP", "en-US"] } })).toBe("en");
    expect(detectPiLocale({ process: { env: { LANG: "zh_CN.UTF-8" } } })).toBe("zh");
    expect(detectPiLocale({})).toBe("en");
    expect(detectHarnessLocale({ navigator: { languages: ["zh-TW"] } })).toBe("zh");
    expect(detectHarnessLocale({ navigator: { language: "en-US" } })).toBe("en");
    expect(detectHarnessLocale({})).toBe("en");
  });

  it("keeps both adapter dictionaries available for the primary UI actions", () => {
    const piEn = createPiText("en");
    const piZh = createPiText("zh");
    expect(piEn.searchTitle()).toBe("Search conversation records");
    expect(piZh.searchTitle()).toBe("搜索对话记录");
    expect(piEn.hiddenUnit("Reasoning")).toContain("hidden");
    expect(piZh.hiddenUnit("思考")).toContain("已隐藏");

    const dshEn = createHarnessText("en");
    const dshZh = createHarnessText("zh");
    expect(dshEn.searchPlaceholder).toContain("Search");
    expect(dshZh.searchPlaceholder).toContain("搜索");
    expect(dshEn.hideSelected(2)).toContain("Hide selected");
    expect(dshZh.hideSelected(2)).toContain("隐藏选中");
  });

  it("keeps Pi Desktop English and Chinese timeline keys in parity", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "pi-app", "src", "renderer", "src", "locales");
    const en = JSON.parse(readFileSync(resolve(root, "en", "timeline.json"), "utf8"));
    const zh = JSON.parse(readFileSync(resolve(root, "zh", "timeline.json"), "utf8"));
    expect(flattenKeys(en)).toEqual(flattenKeys(zh));
  });
});
