import type { Doc } from "@commons/backend/convex/_generated/dataModel";

/** Renders a message body with @Name tokens highlighted for known users. */
export default function MessageText({ body, users }: { body: string; users: Doc<"users">[] }) {
  const names = users.map((u) => u.name).sort((a, b) => b.length - a.length);
  if (names.length === 0) return <span>{body}</span>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  const parts = body.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("@") && names.includes(part.slice(1)) ? (
          <span key={i} className="mention">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}
