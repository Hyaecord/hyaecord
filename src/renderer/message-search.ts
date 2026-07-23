import type { MessageSearchResult } from "@shared/types";
import { el, t } from "./ui";

/**
 * Message search, closing the last real gap in the README's "Search &
 * pinned messages — Not yet built" row. Backed by Discord's own real
 * search endpoints — `GET /guilds/{guild.id}/messages/search` (guild-wide)
 * and `GET /channels/{channel.id}/messages/search` (a single DM, which has
 * no guild) — verified against the discord-userdoccers source
 * (github.com/discord-userdoccers/discord-userdoccers, the project behind
 * docs.discord.food) rather than guessed, since neither endpoint is
 * documented on the page that URL normally serves for message-related
 * things.
 *
 * Deliberately scoped: this searches and lists matches, and clicking one
 * switches to that channel — it does *not* jump to the exact message
 * within the channel's history (the existing message list only loads the
 * most recent page; scrolling/loading around an arbitrary older message ID
 * isn't built yet). That's a real, undisguised gap, not an oversight.
 */

const SEARCH_DEBOUNCE_MS = 400;

export interface MessageSearchScope {
  guildId: string | null;
  channelId: string | null;
}

let openPanel: HTMLElement | null = null;

function closePanel(): void {
  openPanel?.remove();
  openPanel = null;
  document.removeEventListener("pointerdown", onOutsideClick, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutsideClick(ev: PointerEvent): void {
  if (openPanel && !openPanel.contains(ev.target as Node)) closePanel();
}

function onEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closePanel();
}

function renderResults(
  list: HTMLElement,
  result: MessageSearchResult,
  resolveChannelName: (channelId: string) => string,
  onJump: (channelId: string) => void
): void {
  list.replaceChildren();
  if (result.indexing) {
    list.append(el("p", { className: "message-search-empty" }, t("messageSearch.indexing")));
    return;
  }
  if (result.messages.length === 0) {
    list.append(el("p", { className: "message-search-empty" }, t("messageSearch.empty")));
    return;
  }
  for (const msg of result.messages) {
    const row = el(
      "button",
      {
        type: "button",
        className: "message-search-result",
        onClick: () => {
          onJump(msg.channelId);
          closePanel();
        }
      },
      el(
        "div",
        { className: "message-search-result-meta" },
        el("span", { className: "message-search-result-author" }, msg.authorName),
        el("span", { className: "message-search-result-channel" }, resolveChannelName(msg.channelId))
      ),
      el("div", { className: "message-search-result-content" }, msg.content || t("messageSearch.noContent"))
    );
    list.append(row);
  }
}

export function openMessageSearch(
  anchor: HTMLElement,
  scope: MessageSearchScope,
  resolveChannelName: (channelId: string) => string,
  onJump: (channelId: string) => void
): void {
  if (openPanel) {
    closePanel();
    return;
  }

  const searchInput = el("input", {
    type: "text",
    className: "message-search-input",
    placeholder: t("messageSearch.placeholder"),
    "aria-label": t("messageSearch.placeholder")
  }) as HTMLInputElement;
  const list = el("div", { className: "message-search-results" });
  const panel = el(
    "div",
    { className: "message-search-panel", role: "dialog", "aria-label": t("messageSearch.title") },
    searchInput,
    list
  );

  const rect = anchor.getBoundingClientRect();
  panel.style.right = `${window.innerWidth - rect.right}px`;
  panel.style.top = `${rect.bottom + 8}px`;

  document.body.append(panel);
  openPanel = panel;
  document.addEventListener("pointerdown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;
  const runSearch = (query: string) => {
    if (!query.trim()) {
      list.replaceChildren();
      return;
    }
    const thisRequest = ++requestId;
    list.replaceChildren(el("p", { className: "message-search-empty" }, t("messageSearch.loading")));
    void window.hyaecord.searchMessages(query, scope.guildId, scope.channelId).then(result => {
      if (openPanel !== panel || thisRequest !== requestId) return;
      renderResults(list, result, resolveChannelName, onJump);
    });
  };

  searchInput.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value), SEARCH_DEBOUNCE_MS);
  });

  searchInput.focus();
}
