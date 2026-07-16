import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAdapter, AgentTurnHandle, AgentTurnOutcome, AgentTurnRequest } from "./adapter";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function toolSummary(
  name: string,
  input: Record<string, unknown>,
  repoPath: string
): { summary: string; filePath?: string } {
  const relative = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const rel = path.relative(repoPath, value);
    return rel === "" || rel.startsWith("..") ? value : rel;
  };
  switch (name) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "Read": {
      const filePath = relative(input.file_path);
      return { summary: filePath ? `${name} ${filePath}` : name, filePath };
    }
    case "NotebookEdit": {
      const filePath = relative(input.notebook_path);
      return { summary: filePath ? `${name} ${filePath}` : name, filePath };
    }
    case "Bash":
      return { summary: `$ ${String(input.command ?? "").slice(0, 120)}` };
    case "Glob":
    case "Grep":
      return { summary: `${name} ${String(input.pattern ?? "")}` };
    case "TodoWrite":
      return { summary: "Updated plan" };
    default:
      return { summary: name };
  }
}

export const claudeAdapter: AgentAdapter = {
  kind: "claude-code",

  startTurn(request: AgentTurnRequest): AgentTurnHandle {
    const startedAt = Date.now();
    const turn = query({
      prompt: request.prompt,
      options: {
        cwd: request.repoPath,
        resume: request.resumeToken,
        // Edits are auto-approved (the whole point of the loop); Bash is
        // pre-allowed so builds/tests run without a permission prompt we
        // have no UI for yet.
        permissionMode: "acceptEdits",
        allowedTools: ["Bash"],
        settingSources: ["user", "project"],
        maxTurns: 60,
      },
    });

    const done = (async (): Promise<AgentTurnOutcome> => {
      let resumeToken = request.resumeToken;
      let outcome: AgentTurnOutcome = {
        ok: false,
        summary: "Agent exited without producing a result.",
        numTurns: 0,
        durationMs: 0,
        resumeToken,
      };
      try {
        for await (const message of turn) {
          if (message.type === "system" && message.subtype === "init") {
            resumeToken = message.session_id;
            continue;
          }
          if (message.type === "assistant") {
            for (const block of message.message.content) {
              if (block.type === "text" && block.text.trim()) {
                request.emit({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                const input = (block.input ?? {}) as Record<string, unknown>;
                const { summary, filePath } = toolSummary(block.name, input, request.repoPath);
                request.emit({ type: "tool", toolUseId: block.id, name: block.name, summary, filePath });
                if (EDIT_TOOLS.has(block.name)) {
                  const target = input.file_path ?? input.notebook_path;
                  if (typeof target === "string") request.onFileEdited(target);
                }
              }
            }
            continue;
          }
          if (message.type === "user" && Array.isArray(message.message.content)) {
            for (const block of message.message.content) {
              if (typeof block === "object" && block?.type === "tool_result") {
                request.emit({
                  type: "tool-result",
                  toolUseId: block.tool_use_id,
                  isError: block.is_error === true,
                });
              }
            }
            continue;
          }
          if (message.type === "result") {
            resumeToken = message.session_id ?? resumeToken;
            const ok = message.subtype === "success";
            outcome = {
              ok,
              summary: ok && "result" in message && message.result ? message.result : `Agent stopped: ${message.subtype}`,
              numTurns: message.num_turns,
              durationMs: Date.now() - startedAt,
              totalCostUsd: message.total_cost_usd,
              resumeToken,
            };
          }
        }
      } catch (error) {
        outcome = {
          ok: false,
          summary: error instanceof Error ? error.message : String(error),
          numTurns: outcome.numTurns,
          durationMs: Date.now() - startedAt,
          resumeToken,
        };
      }
      outcome.durationMs = Date.now() - startedAt;
      outcome.resumeToken = resumeToken;
      return outcome;
    })();

    return {
      done,
      interrupt: async () => {
        // interrupt() is only supported with streaming input; swallow the
        // failure and let the turn run out if the SDK rejects it.
        try {
          await turn.interrupt();
        } catch {
          /* best effort */
        }
      },
    };
  },
};
