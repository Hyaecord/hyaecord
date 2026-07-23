import { el, state, t } from "./ui";
import { openProfilePopout } from "./profile-popout";
import { getPfpOverride } from "./avatar-overrides";
import { openContextMenu, copyIdItem } from "./context-menu";

/**
 * The member-list sidebar, driven by Discord's gateway "lazy guild loading"
 * protocol (OP 14 / GUILD_MEMBER_LIST_UPDATE) — undocumented officially,
 * verified against the community lazy-guilds write-up rather than guessed.
 * Scoped deliberately to a single subscribed range, [0, 99], same as the
 * official client's initial preload: this renders the first 100 entries of
 * whichever channel is selected and doesn't page further. Re-subscribing
 * (see gateway.ts) replaces the whole window with a SYNC, so there's no
 * stale state to reconcile across channel switches.
 *
 * ⚠ Known gap, not guessed around: GUILD_MEMBER_LIST_UPDATE's `id` field is
 * a "list id" (documented as "the output of the list_id function", per the
 * community lazy-guilds write-up) — not the channel id, and nothing in the
 * documented event body says how to correlate a list id back to a specific
 * channel subscription. Rather than invent a mapping with no source to
 * verify it against, this matches incoming events on guild_id only, which
 * is correct as long as the app holds at most one member-list subscription
 * open at a time (true today — selecting a channel always replaces the
 * previous subscription). If a future feature needs concurrent
 * subscriptions across channels, this will need real correlation and this
 * assumption stops holding.
 */

type MemberGroup = { kind: "group"; id: string; count: number };
type MemberEntry = {
  kind: "member";
  id: string;
  name: string;
  avatar: string | null;
  status: string;
};
type ListItem = MemberGroup | MemberEntry;

interface RawOp {
  op: "SYNC" | "INSERT" | "UPDATE" | "DELETE" | "INVALIDATE";
  range?: [number, number];
  items?: unknown[];
  index?: number;
  item?: unknown;
}

let items: ListItem[] = [];
let roles: Record<string, { name: string; color: number }> = {};
let subscribedGuildId: string | null = null;

export function setActiveGuildRoles(guildRoles: Record<string, { name: string; color: number }>): void {
  roles = guildRoles;
}

export function clearMemberList(): void {
  items = [];
  subscribedGuildId = null;
  render();
}

/** Called right before requesting a new channel's list, so stale entries don't flash while the SYNC is in flight. */
export function beginSubscription(guildId: string): void {
  items = [];
  subscribedGuildId = guildId;
  render();
}

function parseRawItem(raw: unknown): ListItem | null {
  const entry = raw as { group?: { id: string; count: number }; member?: Record<string, unknown> };
  if (entry.group) return { kind: "group", id: entry.group.id, count: entry.group.count };
  if (entry.member) {
    const m = entry.member as {
      user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
      nick?: string | null;
      presence?: { status?: string };
    };
    if (!m.user?.id) return null;
    return {
      kind: "member",
      id: m.user.id,
      name: m.nick ?? m.user.global_name ?? m.user.username ?? "?",
      avatar: m.user.avatar ?? null,
      status: m.presence?.status ?? "offline"
    };
  }
  return null;
}

export function applyMemberListUpdate(data: unknown): void {
  const payload = data as { guild_id?: string; ops?: RawOp[] };
  if (!payload.guild_id || payload.guild_id !== subscribedGuildId) return; // stale event from a guild we've since left
  for (const op of payload.ops ?? []) {
    if (op.op === "SYNC" && op.items) {
      items = op.items.map(parseRawItem).filter((i): i is ListItem => i !== null);
    } else if (op.op === "INSERT" && op.item && op.index !== undefined) {
      const parsed = parseRawItem(op.item);
      if (parsed) items.splice(op.index, 0, parsed);
    } else if (op.op === "UPDATE" && op.item && op.index !== undefined) {
      const parsed = parseRawItem(op.item);
      if (parsed) items[op.index] = parsed;
    } else if (op.op === "DELETE" && op.index !== undefined) {
      items.splice(op.index, 1);
    }
    // INVALIDATE ignored: we only ever subscribe to the [0, 99] range.
  }
  render();
}

function groupLabel(group: MemberGroup): string {
  if (group.id === "online") return t("memberList.online");
  if (group.id === "offline") return t("memberList.offline");
  return roles[group.id]?.name ?? t("memberList.role");
}

function render(): void {
  const list = document.getElementById("member-list")!;
  list.replaceChildren();
  if (items.length === 0) return;

  for (const item of items) {
    if (item.kind === "group") {
      list.append(
        el("h3", { className: "member-group-header" }, `${groupLabel(item)} — ${item.count}`)
      );
      continue;
    }
    const avatarSrc = getPfpOverride(item.id) ?? (item.avatar ? `https://cdn.discordapp.com/avatars/${item.id}/${item.avatar}.png?size=32` : null);
    const avatar = avatarSrc
      ? el("img", { className: "member-avatar", src: avatarSrc, alt: "", loading: "lazy" })
      : el("span", { className: "member-avatar member-avatar-fallback", "aria-hidden": "true" }, item.name[0] ?? "?");
    const row = el(
      "button",
      { type: "button", className: "member-row", title: item.name },
      el("span", { className: `member-status-dot status-${item.status}`, "aria-hidden": "true" }),
      avatar,
      el("span", { className: "member-name" }, item.name)
    );
    row.addEventListener("click", () => openProfilePopout(item.id, row));
    row.addEventListener("contextmenu", ev => {
      if (!state.settings.developerMode) return;
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, [copyIdItem(item.id, t("devMode.copyUserId"))]);
    });
    list.append(row);
  }
}
