import type { VoiceState } from "@shared/types";
import { el, t } from "./ui";
import { icon } from "./icons";

/**
 * The voice status bar — shows join/leave, real connection state, and who
 * else is actually in the channel (from the real voice WebSocket's
 * Clients Connect/Disconnect/Speaking events, see main/voice/voice-gateway.ts).
 *
 * Deliberately does NOT include mute/deafen/camera toggle buttons: none of
 * them would do anything real yet, since this app doesn't send or receive
 * any actual audio/video (no media transport — see voice-gateway.ts's own
 * scope note). Adding controls that look functional but don't do anything
 * is exactly the "dead UI" this project has avoided everywhere else
 * (Developer Mode's context menu, plugin toggles, etc.) — better to ship
 * only what's real: connect, see who's there, disconnect.
 */

let nameResolver: (channelId: string) => string = id => id;

export function setVoiceChannelNameResolver(resolver: (channelId: string) => string): void {
  nameResolver = resolver;
}

export function initVoiceUI(): void {
  window.hyaecord.onVoiceState(renderVoiceBar);
}

function memberChip(userId: string, speaking: boolean): HTMLElement {
  return el(
    "span",
    { className: speaking ? "voice-bar-member is-speaking" : "voice-bar-member", title: userId },
    userId.slice(-4)
  );
}

function renderVoiceBar(voiceState: VoiceState): void {
  const bar = document.getElementById("voice-bar") as HTMLElement;
  bar.replaceChildren();

  if (voiceState.status === "idle" || !voiceState.channelId) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  const statusText =
    voiceState.status === "connecting" ? t("voice.connecting") : t("voice.connected", { channel: nameResolver(voiceState.channelId) });

  const disconnectButton = el(
    "button",
    { type: "button", className: "voice-bar-disconnect", "aria-label": t("voice.disconnect"), onClick: () => window.hyaecord.leaveVoiceChannel() },
    icon("phone-off")
  );

  bar.append(
    el(
      "div",
      { className: "voice-bar-info" },
      el("span", { className: "voice-bar-status" }, statusText),
      el("div", { className: "voice-bar-members" }, ...voiceState.members.map(id => memberChip(id, voiceState.speaking.includes(id))))
    ),
    disconnectButton
  );
}
