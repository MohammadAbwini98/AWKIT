import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { UserAvatar } from "./UserAvatar";

interface AccountMenuProps {
  displayName: string;
  username: string;
  /** Effective role / account classification, e.g. "Super User". */
  roleLabel: string;
  onSignOut: () => void;
}

/**
 * Signed-in user identity + account menu for the application frame. The trigger shows a rounded avatar,
 * display name, and role; clicking (or Enter/Space) opens a small popover of supported account actions.
 * Only actions the application actually supports are offered — today that is Sign out (which revokes the
 * session in the trusted layer). Administration lives in the permission-filtered left navigation, and all
 * access is enforced at the route and IPC layers regardless of what this menu shows.
 */
export function AccountMenu({ displayName, username, roleLabel, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="awkit-account" ref={rootRef}>
      <button
        type="button"
        className="awkit-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        title={`${displayName} (@${username})`}
      >
        <UserAvatar displayName={displayName} username={username} size={26} />
        <span className="awkit-account-meta">
          <span className="awkit-account-name">{displayName}</span>
          <span className="awkit-account-role">{roleLabel}</span>
        </span>
        <ChevronDown size={14} className="awkit-account-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="awkit-account-menu" role="menu" id={menuId} aria-label="Account">
          <div className="awkit-account-menu-head">
            <UserAvatar displayName={displayName} username={username} size={36} />
            <div className="awkit-account-menu-identity">
              <strong>{displayName}</strong>
              <span className="awkit-account-menu-username">@{username}</span>
              <span className="awkit-account-menu-role">{roleLabel}</span>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="awkit-account-menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
