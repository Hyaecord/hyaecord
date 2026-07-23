import type { HyaecordSettings } from "@shared/types";

/** Shared renderer state, populated once by app.ts before anything renders. */
export const state = {
  settings: null as unknown as HyaecordSettings,
  prefersDark: true,
  strings: {} as Record<string, string>
};

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = state.strings[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      node.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
    } else if (key === "className") {
      node.className = String(value);
    } else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  node.append(...children);
  return node;
}

/** CSS custom property names a community theme is allowed to override — nothing else. */
const COMMUNITY_TOKEN_PROPS: Record<string, string> = {
  bgDeep: "--bg-deep",
  bgBase: "--bg-base",
  bgRaise: "--bg-raise",
  bgHover: "--bg-hover",
  border: "--border",
  text: "--text",
  textDim: "--text-dim",
  accent: "--accent",
  accentStrong: "--accent-strong",
  danger: "--danger"
};

function applyCommunityTheme(): void {
  const theme = state.settings.communityTheme;
  const root = document.documentElement;
  for (const [key, prop] of Object.entries(COMMUNITY_TOKEN_PROPS)) {
    const value = theme?.tokens[key as keyof typeof theme.tokens];
    if (value) root.style.setProperty(prop, value);
    else root.style.removeProperty(prop);
  }
}

export function applySettingsToDocument(): void {
  const { settings, prefersDark } = state;
  const resolved =
    settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
  document.body.dataset.theme = resolved;
  document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
  if (settings.reducedMotion === "system") {
    delete document.documentElement.dataset.reducedMotion;
  } else {
    document.documentElement.dataset.reducedMotion = settings.reducedMotion;
  }
  applyCommunityTheme();
}

export async function patchSettings(patch: Partial<HyaecordSettings>): Promise<void> {
  state.settings = await window.hyaecord.setSettings(patch);
  applySettingsToDocument();
}

/**
 * A toggle row where turning ON is a plain click, but turning OFF requires
 * holding the switch for `holdMs` — replaces confirmation popups with a
 * press-and-hold, per project UI direction. Releasing early cancels with no
 * state change; a filled track shows hold progress.
 */
export function holdToggleRow(
  labelKey: string,
  descriptionKey: string | null,
  checked: boolean,
  holdMs: number,
  onChange: (next: boolean) => void
): HTMLElement {
  let isChecked = checked;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fill = el("span", { className: "switch-hold-fill", "aria-hidden": "true" });
  const thumb = el("span", { className: "switch-thumb", "aria-hidden": "true" }, fill);
  const button = el("button", {
    type: "button",
    className: "switch-btn",
    role: "switch",
    "aria-checked": String(isChecked)
  }, thumb) as HTMLButtonElement;

  const cancelHold = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    fill.style.transitionDuration = "150ms";
    fill.style.width = "0%";
  };

  const startHold = () => {
    if (!isChecked || timer) return;
    fill.style.transitionDuration = `${holdMs}ms`;
    requestAnimationFrame(() => (fill.style.width = "100%"));
    timer = setTimeout(() => {
      timer = null;
      fill.style.width = "0%";
      isChecked = false;
      button.setAttribute("aria-checked", "false");
      button.classList.remove("is-on");
      onChange(false);
    }, holdMs);
  };

  button.addEventListener("pointerdown", startHold);
  button.addEventListener("pointerup", cancelHold);
  button.addEventListener("pointerleave", cancelHold);
  button.addEventListener("click", () => {
    if (isChecked || timer) return; // OFF -> ON is instant; ON -> OFF only via completed hold
    isChecked = true;
    button.setAttribute("aria-checked", "true");
    button.classList.add("is-on");
    onChange(true);
  });
  button.classList.toggle("is-on", isChecked);

  const text = el("span", { className: "row-text" }, el("span", { className: "row-label" }, t(labelKey)));
  if (descriptionKey) {
    text.append(el("span", { className: "row-description" }, t(descriptionKey)));
    text.append(el("span", { className: "row-description hold-hint" }, t("settings.holdToDisable")));
  }
  return el("div", { className: "setting-row" }, text, button);
}

/**
 * Cycles `el`'s text through the given i18n keys with a cross-fade, looping
 * continuously. Used for the "Connecting…" header so a slow gateway
 * handshake has something to look at instead of a static string. Returns a
 * cleanup function that stops the rotation (call it once the state that
 * triggered it — e.g. "connecting" — is no longer true).
 */
export function mountRotatingText(target: HTMLElement, keys: string[], intervalMs = 2800): () => void {
  if (keys.length === 0) return () => {};
  let i = 0;
  target.textContent = t(keys[0] as string);
  target.classList.add("rotating-text");
  const timer = setInterval(() => {
    i = (i + 1) % keys.length;
    target.classList.add("is-fading");
    setTimeout(() => {
      target.textContent = t(keys[i] as string);
      target.classList.remove("is-fading");
    }, 180);
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * A small burst of particles from `origin`, used as positive feedback on
 * low-stakes celebratory actions (e.g. starring the repo). Uses the Web
 * Animations API directly — no motion library needed for six dots.
 */
export function burstParticles(origin: { x: number; y: number }): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 6; i++) {
    const dot = el("span", { className: "particle-dot", "aria-hidden": "true" });
    dot.style.left = `${origin.x}px`;
    dot.style.top = `${origin.y}px`;
    document.body.append(dot);
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 28 + Math.random() * 20;
    const anim = dot.animate(
      [
        { transform: "translate(-50%, -50%) scale(0)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(1)`,
          opacity: 0
        }
      ],
      { duration: 550, easing: "cubic-bezier(0.2, 0, 0, 1)", delay: i * 25 }
    );
    anim.onfinish = () => dot.remove();
  }
}

/**
 * A standalone hold-to-confirm button (as opposed to `holdToggleRow`'s
 * switch shape) — the same "hold instead of a popup" pattern applied to a
 * one-shot destructive action like a mass-delete. Releasing early cancels.
 */
export function holdButton(
  label: string,
  holdMs: number,
  onConfirm: () => void,
  variant: "danger" | "primary" = "danger"
): HTMLButtonElement {
  const fill = el("span", { className: "hold-btn-fill", "aria-hidden": "true" });
  const text = el("span", { className: "hold-btn-label" }, label);
  const btn = el("button", { type: "button", className: `btn hold-btn ${variant}` }, fill, text) as HTMLButtonElement;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    fill.style.transitionDuration = "150ms";
    fill.style.width = "0%";
  };
  const start = () => {
    if (timer) return;
    fill.style.transitionDuration = `${holdMs}ms`;
    requestAnimationFrame(() => (fill.style.width = "100%"));
    timer = setTimeout(() => {
      timer = null;
      fill.style.width = "0%";
      onConfirm();
    }, holdMs);
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointerleave", cancel);
  return btn;
}

let toastContainer: HTMLElement | null = null;

/** A brief, non-blocking status message — used for permission denials, errors, and confirmations. */
export function showToast(message: string): void {
  if (!toastContainer) {
    toastContainer = el("div", { className: "toast-container", role: "status", "aria-live": "polite" });
    document.body.append(toastContainer);
  }
  const toast = el("div", { className: "toast" }, message);
  toastContainer.append(toast);
  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

/** Wrap Tab focus inside `container` and return a cleanup function. */
export function trapFocus(container: HTMLElement): () => void {
  const selector =
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key !== "Tab") return;
    const focusable = [...container.querySelectorAll<HTMLElement>(selector)].filter(
      f => !f.hasAttribute("disabled")
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKeydown);
  return () => container.removeEventListener("keydown", onKeydown);
}

/**
 * A labelled switch row: [label + description | toggle].
 * `onChange` may return false (or resolve to false) to veto the change,
 * e.g. when a disable-confirmation dialog is cancelled.
 */
export function toggleRow(
  labelKey: string,
  descriptionKey: string | null,
  checked: boolean,
  onChange: (next: boolean) => boolean | void | Promise<boolean | void>
): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    className: "switch-input"
  }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener("change", async () => {
    const next = input.checked;
    if ((await onChange(next)) === false) input.checked = !next;
  });

  const text = el("span", { className: "row-text" }, el("span", { className: "row-label" }, t(labelKey)));
  if (descriptionKey) {
    text.append(el("span", { className: "row-description" }, t(descriptionKey)));
  }
  return el(
    "label",
    { className: "setting-row" },
    text,
    el("span", { className: "switch" }, input, el("span", { className: "switch-thumb", "aria-hidden": "true" }))
  );
}
