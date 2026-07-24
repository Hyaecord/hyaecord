import { el } from "./ui";

/**
 * "@mention" composer autocomplete for Stoat — real reply/mention
 * rendering (`<@id>`, item 84) existed with no way to actually *type* one
 * other than knowing someone's raw ULID by hand. Mirrors
 * slash-commands.ts's own suggestion-popup pattern (click to pick, same
 * positioning shape) rather than inventing a new one.
 */

export interface MentionCandidate {
  id: string;
  displayName: string;
  username: string;
}

let suggestionsEl: HTMLElement | null = null;

export function closeMentionSuggestions(): void {
  suggestionsEl?.remove();
  suggestionsEl = null;
}

export function showMentionSuggestions(
  anchor: HTMLElement,
  query: string,
  candidates: MentionCandidate[],
  onPick: (candidate: MentionCandidate) => void
): void {
  const lower = query.toLowerCase();
  const matches = candidates
    .filter(c => c.username.toLowerCase().includes(lower) || c.displayName.toLowerCase().includes(lower))
    .slice(0, 8);
  closeMentionSuggestions();
  if (matches.length === 0) return;

  const list = el(
    "div",
    { className: "slash-suggestions mention-suggestions", role: "listbox" },
    ...matches.map(c =>
      el(
        "button",
        { type: "button", className: "slash-suggestion", role: "option", onClick: () => onPick(c) },
        el("span", { className: "slash-suggestion-name" }, c.displayName),
        el("span", { className: "slash-suggestion-desc" }, `@${c.username}`)
      )
    )
  );

  const rect = anchor.getBoundingClientRect();
  list.style.left = `${rect.left}px`;
  list.style.bottom = `${window.innerHeight - rect.top + 8}px`;

  document.body.append(list);
  suggestionsEl = list;
}
