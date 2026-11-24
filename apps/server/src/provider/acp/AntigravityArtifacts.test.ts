// @effect-diagnostics nodeBuiltinImport:off -- Uses direct temp profile paths and symlinks to test traversal/link rejection.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { EMPTY_ANTIGRAVITY_ARTIFACTS, readAntigravityArtifacts } from "./AntigravityArtifacts.ts";

it.effect(
  "scans top-level brain markdown artifacts, pairs sidecars, merges recorded metadata, and excludes internals",
  () =>
    Effect.gen(function* () {
      const profileDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ag-artifacts-")),
      );
      try {
        const sessionId = "session-art-1";
        const brainDir = NodePath.join(profileDir, "antigravity-acp", "brain", sessionId);
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.join(brainDir, ".system_generated"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.join(brainDir, "scratch"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.join(brainDir, "media"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(brainDir, ".system_generated", "secret.md"), "# Secret"),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(brainDir, "scratch", "notes.md"), "# Scratch"),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(brainDir, "media", "diagram.png"), "png"),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(brainDir, "implementation_plan.md"),
            [
              "# Implementation Plan",
              "",
              "![arch](./media/diagram.png)",
              "![bad](../escape.png)",
              "![web](https://example.com/pic.png)",
            ].join("\n"),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(brainDir, "implementation_plan.md.metadata.json"),
            JSON.stringify({
              Summary: "Architecture plan",
              UserFacing: true,
              RequestFeedback: true,
            }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(brainDir, "walkthrough.md"),
            "# Final Walkthrough\n\nScreenshot: media/diagram.png | Check\n",
          ),
        );

        const res = yield* readAntigravityArtifacts({
          profileDirectory: profileDir,
          rootSessionId: sessionId,
          recordedItems: [
            {
              toolName: "write_file",
              input: {
                Path: `${brainDir}/walkthrough.md`,
                ArtifactMetadata: {
                  Summary: "Walkthrough summary from tool",
                  UserFacing: true,
                  RequestFeedback: false,
                },
              },
            },
          ],
        });

        expect(res.artifacts.map((a) => a.fileName).toSorted()).toEqual([
          "implementation_plan.md",
          "walkthrough.md",
        ]);

        const plan = res.artifacts.find((a) => a.fileName === "implementation_plan.md");
        assert.isDefined(plan);
        assert.equal(plan?.title, "Implementation Plan");
        assert.equal(plan?.kind, "plan");
        assert.equal(plan?.summary, "Architecture plan");
        assert.equal(plan?.userFacing, true);
        assert.equal(plan?.requestFeedback, true);
        assert.deepEqual(plan?.mediaPaths, ["media/diagram.png"]);

        const walkthrough = res.artifacts.find((a) => a.fileName === "walkthrough.md");
        assert.equal(walkthrough?.kind, "walkthrough");
        assert.equal(walkthrough?.summary, "Walkthrough summary from tool");
        assert.equal(walkthrough?.userFacing, true);
        assert.equal(walkthrough?.requestFeedback, false);
        assert.deepEqual(walkthrough?.mediaPaths, ["media/diagram.png"]);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(profileDir, { recursive: true, force: true }));
      }
    }),
);

it.effect(
  "caps oversized artifact content cleanly with truncated flag and rejects symlinks/traversal",
  () =>
    Effect.gen(function* () {
      const profileDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ag-artifacts-sec-")),
      );
      try {
        assert.deepEqual(
          yield* readAntigravityArtifacts({
            profileDirectory: profileDir,
            rootSessionId: "../bad",
          }),
          EMPTY_ANTIGRAVITY_ARTIFACTS,
        );

        const sessionId = "session-sec-1";
        const brainDir = NodePath.join(profileDir, "antigravity-acp", "brain", sessionId);
        yield* Effect.promise(() => NodeFSP.mkdir(brainDir, { recursive: true }));
        const largeContent = `# Big Notes\n\n${"x".repeat(70_000)}`;
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(brainDir, "notes.md"), largeContent),
        );

        const outsideMd = NodePath.join(profileDir, "outside.md");
        yield* Effect.promise(() => NodeFSP.writeFile(outsideMd, "# Outside Secret"));
        const symlinked = yield* Effect.promise(() =>
          NodeFSP.symlink(outsideMd, NodePath.join(brainDir, "symlinked.md"))
            .then(() => true)
            .catch(() => false),
        );

        const res = yield* readAntigravityArtifacts({
          profileDirectory: profileDir,
          rootSessionId: sessionId,
        });

        const notes = res.artifacts.find((a) => a.fileName === "notes.md");
        assert.equal(notes?.truncated, true);
        assert.equal(notes?.kind, "other");
        assert.isBelow(notes?.content.length ?? 0, largeContent.length);
        if (symlinked) {
          assert.isUndefined(res.artifacts.find((a) => a.fileName === "symlinked.md"));
        }
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(profileDir, { recursive: true, force: true }));
      }
    }),
);
