import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type T3McpAutoApproveSettings,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import * as McpProviderSessions from "./McpProviderSessions.ts";

describe("McpProviderSessions tool results", () => {
  const threadId = ThreadId.make("thread-tool-results");

  it.effect(
    "requires exact (tool, input, output) match when reported and refuses ambiguous differing outputs",
    () =>
      Effect.gen(function* () {
        const sessions = yield* McpProviderSessions.McpProviderSessions;
        yield* sessions.recordToolResult(
          threadId,
          "send_to_user",
          { message: "A" },
          { isError: true },
        );
        yield* sessions.recordToolResult(
          threadId,
          "send_to_user",
          { message: "B" },
          { sentMessage: "B" },
        );

        // A reported error for input B must not drain A's error or B's success.
        assert.strictEqual(
          yield* sessions.takeToolResult(
            threadId,
            "send_to_user",
            { message: "B" },
            { isError: true },
          ),
          undefined,
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(
            threadId,
            "send_to_user",
            { message: "A" },
            { isError: true },
          ),
          { isError: true },
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(threadId, "send_to_user", { message: "B" }),
          { sentMessage: "B" },
        );

        // Identical inputs with identical outputs are interchangeable.
        yield* sessions.recordToolResult(
          threadId,
          "send_to_user",
          { message: "Same" },
          { sentMessage: "Same" },
        );
        yield* sessions.recordToolResult(
          threadId,
          "send_to_user",
          { message: "Same" },
          { sentMessage: "Same" },
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(threadId, "send_to_user", { message: "Same" }),
          { sentMessage: "Same" },
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(threadId, "send_to_user", { message: "Same" }),
          { sentMessage: "Same" },
        );

        // Identical inputs with differing outputs stay unclaimed on input-only lookup.
        yield* sessions.recordToolResult(
          threadId,
          "delegate_task",
          { task: "Audit" },
          { taskId: "task-1" },
        );
        yield* sessions.recordToolResult(
          threadId,
          "delegate_task",
          { task: "Audit" },
          { taskId: "task-2" },
        );
        assert.strictEqual(
          yield* sessions.takeToolResult(threadId, "delegate_task", { task: "Audit" }),
          undefined,
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(
            threadId,
            "delegate_task",
            { task: "Audit" },
            { taskId: "task-2" },
          ),
          { taskId: "task-2" },
        );
        assert.deepEqual(
          yield* sessions.takeToolResult(threadId, "delegate_task", { task: "Audit" }),
          { taskId: "task-1" },
        );
      }).pipe(Effect.provide(McpProviderSessions.layer)),
  );

  it.effect("drops stale-session writes and clears unconsumed results on clearToolResults", () =>
    Effect.gen(function* () {
      const sessions = yield* McpProviderSessions.McpProviderSessions;
      yield* sessions.set({
        environmentId: EnvironmentId.make("env-tool-results"),
        threadId,
        providerSessionId: "session-2",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1/mcp",
        authorizationHeader: "Bearer token",
        browserToolsAvailable: false,
      });
      // A handler finishing for replaced session-1 must not populate session-2.
      yield* sessions.recordToolResult(
        threadId,
        "send_to_user",
        { message: "Old" },
        { sentMessage: "Old" },
        { providerSessionId: "session-1" },
      );
      assert.strictEqual(
        yield* sessions.takeToolResult(threadId, "send_to_user", { message: "Old" }),
        undefined,
      );

      yield* sessions.recordToolResult(
        threadId,
        "send_to_user",
        { message: "Current" },
        { sentMessage: "Current" },
        { providerSessionId: "session-2" },
      );
      const turn1Epoch = yield* sessions.toolResultEpoch(threadId);
      yield* sessions.clearToolResults(threadId);
      assert.strictEqual(
        yield* sessions.takeToolResult(threadId, "send_to_user", { message: "Current" }),
        undefined,
      );

      // A handler started in turn 1 that finishes after turn cleanup must not populate turn 2,
      // even when the same provider session is reused.
      yield* sessions.recordToolResult(
        threadId,
        "send_to_user",
        { message: "Late from turn 1" },
        { sentMessage: "Late from turn 1" },
        { providerSessionId: "session-2", epoch: turn1Epoch },
      );
      assert.strictEqual(
        yield* sessions.takeToolResult(threadId, "send_to_user", { message: "Late from turn 1" }),
        undefined,
      );
    }).pipe(Effect.provide(McpProviderSessions.layer)),
  );
});

describe("McpProviderSessions T3 MCP auto-approval", () => {
  it.effect("merges global and per-thread overrides and supports session/global grants", () =>
    Effect.gen(function* () {
      const globalRef = yield* Ref.make<T3McpAutoApproveSettings>({
        mode: "selected",
        tools: ["preview_open"],
      });
      const layer = McpProviderSessions.layerWithGlobalT3McpAutoApprove({
        read: Ref.get(globalRef),
        update: (updater) =>
          Ref.modify(globalRef, (current) => {
            const next = updater(current);
            return [next, next];
          }),
      });

      yield* Effect.gen(function* () {
        const sessions = yield* McpProviderSessions.McpProviderSessions;
        const threadA = ThreadId.make("thread-mcp-a");
        const threadB = ThreadId.make("thread-mcp-b");

        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadA, "preview_open"));
        assert.isFalse(yield* sessions.shouldAutoApproveT3McpTool(threadA, "html_preview"));

        // Session allow preserves globally approved tools on threadA without affecting threadB.
        const afterSessionAllow = yield* sessions.allowT3McpToolForSession(threadA, "html_preview");
        assert.deepEqual(afterSessionAllow, {
          mode: "selected",
          tools: ["html_preview", "preview_open"],
        });
        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadA, "html_preview"));
        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadA, "preview_open"));
        assert.isFalse(yield* sessions.shouldAutoApproveT3McpTool(threadB, "html_preview"));

        // Turning a thread override off blocks even globally approved tools on that thread.
        const forcedOff = yield* sessions.setThreadT3McpAutoApprove(threadB, {
          mode: "off",
          tools: [],
        });
        assert.deepEqual(forcedOff.effective, { mode: "off", tools: [] });
        assert.isFalse(yield* sessions.shouldAutoApproveT3McpTool(threadB, "preview_open"));

        // Clearing threadB restores global inheritance.
        const resetB = yield* sessions.setThreadT3McpAutoApprove(threadB, null);
        assert.isNull(resetB.sessionOverride);
        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadB, "preview_open"));

        // Clearing session HTTP metadata keeps thread auto-approve override intact.
        yield* sessions.clear(threadA);
        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadA, "html_preview"));

        // Global allow updates the shared global store for all threads without an override.
        const nextGlobal = yield* sessions.allowT3McpToolGlobally("html_render");
        assert.deepEqual(nextGlobal, {
          mode: "selected",
          tools: ["html_render", "preview_open"],
        });
        assert.isTrue(yield* sessions.shouldAutoApproveT3McpTool(threadB, "html_render"));
      }).pipe(Effect.provide(layer));
    }),
  );
});
