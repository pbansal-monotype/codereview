export const MAX_TOOL_HOPS = 3;

export const TOOL_INSTRUCTIONS = `
## On-demand context tools

You may request additional context before finalizing findings. Respond with JSON in ONE of these forms:

**Request a tool** (up to ${MAX_TOOL_HOPS} times):
{
  "action": "tool",
  "tool": "read_file" | "search_text" | "find_references",
  "arguments": { ... }
}

Tool argument schemas:
- read_file: { "path": "src/foo.ts" }
- search_text: { "path_pattern"?: "*.ts", "pattern": "regex or literal" }
- find_references: { "symbol": "functionName", "file_path": "src/foo.ts" }

**Return final findings**:
{
  "action": "done",
  "findings": [ ... same schema as specialist findings ... ]
}

Use tools when the shared context is insufficient — especially for signature/API changes.
After tool results, either call another tool or return action "done".
`;

export const TOOL_CATEGORIES = new Set(['security', 'code']);
