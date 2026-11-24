import { T3_MCP_TOOL_NAMES } from "./t3McpToolPresentation.ts";
import {
  normalizeT3McpAutoApproveTools,
  resolveEffectiveT3McpAutoApprove,
  shouldAutoApproveT3McpTool,
  T3_MCP_AUTO_APPROVE_CATEGORIES,
  withAddedT3McpAutoApproveTool,
  withToggledT3McpAutoApproveTool,
} from "./t3McpAutoApprove.ts";
import { describe, expect, it } from "vite-plus/test";

describe("t3McpAutoApprove", () => {
  it("categorizes every tool in T3_MCP_TOOL_NAMES exactly once without duplicates", () => {
    const categorized: Array<string> = [];
    for (const category of T3_MCP_AUTO_APPROVE_CATEGORIES) {
      categorized.push(...category.tools);
    }
    const unique = new Set(categorized);
    expect(unique.size).toBe(categorized.length);
    expect(unique).toEqual(T3_MCP_TOOL_NAMES);
  });

  it("normalizes prefixes, deduplicates, and sorts selected tools", () => {
    expect(
      normalizeT3McpAutoApproveTools([
        "  mcp_t3-code_html_render ",
        "mcp__t3-code__html_preview",
        "html_render",
        "",
        "send_to_user",
      ]),
    ).toEqual(["html_preview", "html_render", "send_to_user"]);
  });

  it("evaluates off, selected, and all modes against bare and prefixed T3 MCP names", () => {
    expect(shouldAutoApproveT3McpTool(null, "html_preview")).toBe(false);
    expect(
      shouldAutoApproveT3McpTool({ mode: "off", tools: ["html_preview"] }, "html_preview"),
    ).toBe(false);
    expect(
      shouldAutoApproveT3McpTool({ mode: "selected", tools: ["html_preview"] }, "html_preview"),
    ).toBe(true);
    expect(
      shouldAutoApproveT3McpTool(
        { mode: "selected", tools: ["html_preview"] },
        "mcp__t3-code__html_preview",
      ),
    ).toBe(true);
    expect(
      shouldAutoApproveT3McpTool(
        { mode: "selected", tools: ["html_preview"] },
        "mcp_t3-code_html_preview",
      ),
    ).toBe(true);
    expect(
      shouldAutoApproveT3McpTool({ mode: "selected", tools: ["html_preview"] }, "html_render"),
    ).toBe(false);
    expect(shouldAutoApproveT3McpTool({ mode: "all", tools: [] }, "preview_open")).toBe(true);
    expect(shouldAutoApproveT3McpTool({ mode: "all", tools: [] }, "bash")).toBe(false);
  });

  it("resolves session overrides over global defaults and updates tools cleanly", () => {
    const global = { mode: "selected" as const, tools: ["html_preview"] };
    expect(resolveEffectiveT3McpAutoApprove(global, null)).toEqual(global);
    expect(
      resolveEffectiveT3McpAutoApprove(global, {
        mode: "off",
        tools: [],
      }),
    ).toEqual({ mode: "off", tools: [] });

    expect(withAddedT3McpAutoApproveTool({ mode: "off", tools: [] }, "html_render")).toEqual({
      mode: "selected",
      tools: ["html_render"],
    });
    expect(
      withToggledT3McpAutoApproveTool({ mode: "selected", tools: ["html_render"] }, "html_render"),
    ).toEqual({
      mode: "off",
      tools: [],
    });
  });
});
