import { useId, useState } from "react";
import type { OrchestrationV2NativeArtifact } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { CheckIcon, MessageSquareIcon, SendIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

export interface ArtifactHeading {
  readonly id: string;
  readonly level: number;
  readonly title: string;
}

const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const CODE_FENCE_LINE = /^\s*(`{3,}|~{3,})/;

function parseArtifactHeadings(markdown: string): ReadonlyArray<ArtifactHeading> {
  const headings: ArtifactHeading[] = [];
  let activeFence: { readonly char: string; readonly length: number } | null = null;

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = CODE_FENCE_LINE.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const fenceChar = fence[0]!;
      if (activeFence === null) {
        activeFence = { char: fenceChar, length: fence.length };
        continue;
      }
      if (
        activeFence.char === fenceChar &&
        fence.length >= activeFence.length &&
        line.slice(fenceMatch[0].length).trim() === ""
      ) {
        activeFence = null;
        continue;
      }
    }
    if (activeFence !== null) continue;

    const match = HEADING_LINE.exec(line);
    if (!match) continue;
    const title = match[2]!.trim();
    if (title.length === 0) continue;
    headings.push({
      id: `${index}:${title}`,
      level: match[1]!.length,
      title,
    });
  }

  return headings;
}

function buildFeedbackMessage(input: {
  readonly fileName: string;
  readonly comment: string;
  readonly sectionTitle: string | null;
}): string {
  const trimmed = input.comment.trim();
  if (input.sectionTitle !== null) {
    // oxlint-disable-next-line t3code/no-untranslated-copy -- agent prompt sent to provider stays English
    return `Review feedback on ${input.fileName} (section "${input.sectionTitle}"):\n${trimmed}`;
  }
  // oxlint-disable-next-line t3code/no-untranslated-copy -- agent prompt sent to provider stays English
  return `Review feedback on ${input.fileName}:\n${trimmed}`;
}

export interface ArtifactReviewBarProps {
  readonly artifact: OrchestrationV2NativeArtifact;
  readonly onSendFeedback: (text: string) => void;
  readonly onInsertDraft: (text: string) => void;
}

export function ArtifactReviewBar(props: ArtifactReviewBarProps) {
  const { artifact } = props;
  const gt = useGT();
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [comment, setComment] = useState("");
  const [selectedHeadingId, setSelectedHeadingId] = useState("");
  const commentInputId = useId();
  const sectionSelectId = useId();

  if (artifact.kind !== "plan" && !artifact.requestFeedback) {
    return null;
  }

  const headings = parseArtifactHeadings(artifact.content);
  const selectedHeading = headings.find((heading) => heading.id === selectedHeadingId) ?? null;
  const effectiveHeadingId = selectedHeading?.id ?? "";
  const trimmedComment = comment.trim();
  const canSubmit = trimmedComment.length > 0;

  const handleApprove = () => {
    props.onSendFeedback(`Approved ${artifact.fileName}. Please proceed.`);
  };

  const resetForm = () => {
    setComment("");
    setSelectedHeadingId("");
    setRequestingChanges(false);
  };

  const handleSendFeedback = () => {
    if (!canSubmit) return;
    props.onSendFeedback(
      buildFeedbackMessage({
        fileName: artifact.fileName,
        comment: trimmedComment,
        sectionTitle: selectedHeading?.title ?? null,
      }),
    );
    resetForm();
  };

  const handleInsertDraft = () => {
    if (!canSubmit) return;
    props.onInsertDraft(
      buildFeedbackMessage({
        fileName: artifact.fileName,
        comment: trimmedComment,
        sectionTitle: selectedHeading?.title ?? null,
      }),
    );
    resetForm();
  };

  return (
    <div className="border-t border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {artifact.requestFeedback ? (
            <T>Review requested before proceeding.</T>
          ) : (
            <T>Approve this plan or request changes.</T>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={requestingChanges ? "secondary" : "outline"}
            aria-expanded={requestingChanges}
            onClick={() => setRequestingChanges((open) => !open)}
          >
            <MessageSquareIcon aria-hidden="true" />
            <T>Request Changes</T>
          </Button>
          <Button type="button" size="sm" variant="default" onClick={handleApprove}>
            <CheckIcon aria-hidden="true" />
            <T>Approve &amp; Proceed</T>
          </Button>
        </div>
      </div>

      {requestingChanges ? (
        <div className="mt-3 grid gap-3 border-t border-border/50 pt-3">
          {headings.length > 0 ? (
            <div className="grid gap-1.5">
              <label htmlFor={sectionSelectId} className="text-xs font-medium text-foreground">
                <T>Section (optional)</T>
              </label>
              <Select
                value={effectiveHeadingId}
                onValueChange={(next) => setSelectedHeadingId(typeof next === "string" ? next : "")}
              >
                <SelectTrigger id={sectionSelectId} size="sm" aria-label={gt("Section (optional)")}>
                  <SelectValue>
                    {selectedHeading ? selectedHeading.title : gt("Whole artifact")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  <SelectItem value="">{gt("Whole artifact")}</SelectItem>
                  {headings.map((heading) => (
                    <SelectItem key={heading.id} value={heading.id}>
                      {"#".repeat(heading.level)} {heading.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor={commentInputId} className="text-xs font-medium text-foreground">
              <T>Change request</T>
            </label>
            <Textarea
              id={commentInputId}
              size="sm"
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={gt("Describe what should change in this artifact...")}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canSubmit}
              onClick={handleInsertDraft}
            >
              <T>Insert into Draft</T>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!canSubmit}
              onClick={handleSendFeedback}
            >
              <SendIcon aria-hidden="true" />
              <T>Send Feedback</T>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
