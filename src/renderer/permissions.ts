/**
 * Discord permission computation (guild roles + channel overwrites → an
 * effective permission bitfield), following the algorithm from Discord's own
 * developer docs: base = @everyone role permissions ∪ the member's other
 * roles; ADMINISTRATOR short-circuits to "everything"; then the @everyone
 * channel overwrite applies, then the union of the member's role-specific
 * overwrites, then any member-specific overwrite (highest precedence).
 *
 * ⚠ The exact shape of guild/member/role data in the *user*-account gateway
 * READY payload is unverified against a real session (see BUILD_PROMPT.md).
 * This module is defensive on purpose: any missing field resolves toward
 * "no permission" rather than guessing a grant, since the only consumer is
 * gating destructive UI (Moderator View).
 */

// Permission bit flags actually used in this app — add more only as needed.
export const Permission = {
  MANAGE_CHANNELS: 1n << 4n,
  ADMINISTRATOR: 1n << 3n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n
} as const;

interface RawRole {
  id?: string;
  permissions?: string;
}

interface RawOverwrite {
  id?: string;
  type?: number; // 0 = role, 1 = member
  allow?: string;
  deny?: string;
}

interface RawChannel {
  id?: string;
  permission_overwrites?: RawOverwrite[];
}

interface RawGuild {
  id?: string;
  roles?: RawRole[];
  /** Present on some user-gateway payload shapes; the current member's role ids. */
  member?: { roles?: string[] };
  /** Alternative shape: a members array including the self entry. */
  members?: Array<{ user?: { id?: string }; roles?: string[] }>;
}

function toBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function selfRoleIds(guild: RawGuild, selfUserId: string): string[] {
  if (guild.member?.roles) return guild.member.roles;
  const selfMember = guild.members?.find(m => m.user?.id === selfUserId);
  return selfMember?.roles ?? [];
}

/** Returns 0n (no permissions) if the guild/role/member data isn't available yet. */
export function computeChannelPermissions(
  guild: RawGuild,
  channel: RawChannel,
  selfUserId: string
): bigint {
  const roles = guild.roles ?? [];
  const everyoneRole = roles.find(r => r.id === guild.id);
  let base = toBigInt(everyoneRole?.permissions);

  const myRoleIds = new Set(selfRoleIds(guild, selfUserId));
  for (const role of roles) {
    if (role.id && myRoleIds.has(role.id)) base |= toBigInt(role.permissions);
  }

  if (base & Permission.ADMINISTRATOR) {
    return (1n << 41n) - 1n; // everything
  }

  const overwrites = channel.permission_overwrites ?? [];
  const everyoneOverwrite = overwrites.find(o => o.id === guild.id);
  if (everyoneOverwrite) {
    base &= ~toBigInt(everyoneOverwrite.deny);
    base |= toBigInt(everyoneOverwrite.allow);
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && overwrite.id && myRoleIds.has(overwrite.id)) {
      roleAllow |= toBigInt(overwrite.allow);
      roleDeny |= toBigInt(overwrite.deny);
    }
  }
  base &= ~roleDeny;
  base |= roleAllow;

  const memberOverwrite = overwrites.find(o => o.type === 1 && o.id === selfUserId);
  if (memberOverwrite) {
    base &= ~toBigInt(memberOverwrite.deny);
    base |= toBigInt(memberOverwrite.allow);
  }

  return base;
}

export function hasPermission(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}
