import { useEffect, useState } from "react";
import { avatarPaletteIndex, initialsFromIdentity, type AvatarIdentity } from "../../lib/initials";

/** Number of deterministic avatar background tones defined in global.css (.awkit-avatar.tone-0…5). */
const AVATAR_PALETTE_SIZE = 6;

interface UserAvatarProps extends AvatarIdentity {
  /** Optional uploaded profile image. Falls back to initials on load error or when absent. */
  imageUrl?: string | null;
  /** Rendered diameter in px. */
  size?: number;
  /** Locale hint for safe uppercasing (e.g. from the app's locale). */
  locale?: string;
  className?: string;
}

/**
 * Fully-rounded signed-in user avatar. Source priority: valid uploaded image → generated Teams-style
 * initials → a generic "?" when no name/username/email exists. The background tone is derived
 * deterministically from the identity, so the same user always keeps the same colour across launches.
 * Decorative by default (the visible name/role label carries the accessible identity).
 */
export function UserAvatar({ imageUrl, size = 32, locale, className, ...identity }: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  // Reset the failure flag if the image source changes (e.g. after a profile-image update).
  useEffect(() => setImageFailed(false), [imageUrl]);

  const initials = initialsFromIdentity(identity, locale);
  const tone = avatarPaletteIndex(identity, AVATAR_PALETTE_SIZE);
  const dimension = { width: size, height: size } as const;
  const classes = `awkit-avatar${className ? ` ${className}` : ""}`;

  if (imageUrl && !imageFailed) {
    return (
      <img
        className={classes}
        src={imageUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={dimension}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`${classes} tone-${tone}`}
      aria-hidden="true"
      style={{ ...dimension, fontSize: Math.round(size * 0.42) }}
    >
      {initials}
    </span>
  );
}
