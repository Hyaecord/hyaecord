import { el, showToast, t, trapFocus } from "./ui";
import { icon } from "./icons";
import { previewStoatInvite, joinStoatServer, createStoatServer } from "./stoat-session";

/**
 * "Join a Stoat server" — real gap found while auditing reachable UI:
 * there was no way to add a *new* server to the account at all, only
 * interact with ones already in the Ready snapshot. Backed by Stoat's
 * real invite endpoints (`GET`/`POST /invites/{code}`, confirmed via its
 * OpenAPI spec — `rest.ts`), a two-step preview-then-join flow like
 * Discord's own official client uses for invite links, not an
 * immediate blind join.
 */

let openDialog: HTMLElement | null = null;

export function openJoinServerDialog(): void {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  const close = () => {
    cleanup();
    overlay.remove();
    openDialog = null;
  };

  const codeInput = el("input", {
    type: "text",
    className: "friend-add-input",
    placeholder: t("joinServer.placeholder"),
    "aria-label": t("joinServer.placeholder")
  }) as HTMLInputElement;
  const previewArea = el("div", { className: "join-server-preview" });
  const errorEl = el("p", { className: "login-error", role: "alert" });
  let previewedCode: string | null = null;

  const previewButton = el(
    "button",
    {
      type: "button",
      className: "btn",
      onClick: async () => {
        errorEl.textContent = "";
        previewArea.replaceChildren();
        const value = codeInput.value.trim();
        if (!value) return;
        const res = await previewStoatInvite(value);
        if (!res.ok) {
          errorEl.textContent = t("joinServer.invalid");
          return;
        }
        previewedCode = value;
        previewArea.append(
          el(
            "div",
            { className: "join-server-card" },
            res.invite.serverIcon
              ? el("img", { src: res.invite.serverIcon, alt: "", className: "join-server-icon" })
              : el("span", { className: "join-server-icon join-server-icon-fallback" }, res.invite.serverName[0] ?? "?"),
            el(
              "div",
              {},
              el("p", { className: "join-server-name" }, res.invite.serverName),
              el("p", { className: "step-hint" }, t("joinServer.memberCount", { count: res.invite.memberCount }))
            ),
            el(
              "button",
              {
                type: "button",
                className: "btn primary",
                onClick: async () => {
                  if (!previewedCode) return;
                  const joinRes = await joinStoatServer(previewedCode);
                  if (joinRes.ok) {
                    showToast(t("joinServer.joined", { name: res.invite.serverName }));
                    close();
                  } else {
                    errorEl.textContent = t("joinServer.invalid");
                  }
                }
              },
              t("joinServer.join")
            )
          )
        );
      }
    },
    t("joinServer.preview")
  );

  // Real "create a new server" — same real gap category as joining
  // (there was no way to add a server to the account at all), just the
  // other half of it. POST /servers/create only needs a name, so this
  // doesn't need an icon-upload flow (deliberately not built this pass —
  // see stoat-session.ts's module doc comment).
  const createNameInput = el("input", {
    type: "text",
    className: "friend-add-input",
    placeholder: t("joinServer.createPlaceholder"),
    "aria-label": t("joinServer.createPlaceholder")
  }) as HTMLInputElement;
  const createError = el("p", { className: "login-error", role: "alert" });
  const createButton = el(
    "button",
    {
      type: "button",
      className: "btn primary",
      onClick: async () => {
        createError.textContent = "";
        const name = createNameInput.value.trim();
        if (!name) return;
        const res = await createStoatServer(name);
        if (res.ok) {
          showToast(t("joinServer.created", { name }));
          close();
        } else {
          createError.textContent = t("joinServer.invalid");
        }
      }
    },
    t("joinServer.create")
  );

  const dialog = el(
    "div",
    { className: "modal join-server-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "join-server-title" },
    el(
      "div",
      { className: "settings-header" },
      el("h1", { id: "join-server-title" }, t("joinServer.title")),
      el("button", { className: "btn ghost close", type: "button", "aria-label": t("settings.close"), onClick: close }, icon("x"))
    ),
    el("p", { className: "modal-subtitle" }, t("joinServer.subtitle")),
    el("div", { className: "friend-add-row" }, codeInput, previewButton),
    errorEl,
    previewArea,
    el("h2", { className: "join-server-divider" }, t("joinServer.orCreate")),
    el("div", { className: "friend-add-row" }, createNameInput, createButton),
    createError
  );

  const overlay = el("div", { className: "overlay" }, dialog);
  overlay.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
  });
  overlay.addEventListener("mousedown", ev => {
    if (ev.target === overlay) close();
  });
  document.body.append(overlay);
  openDialog = overlay;
  const cleanup = trapFocus(overlay);
  codeInput.focus();
}
