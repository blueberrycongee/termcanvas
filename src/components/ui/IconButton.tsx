import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type IconButtonTone = "neutral" | "danger";
export type IconButtonSize = "sm" | "md";

interface Props
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "title" | "aria-label" | "children"
  > {
  /**
   * Required accessible label. Becomes both `title` (tooltip) and
   * `aria-label`. P6: icon-only buttons must always be labeled.
   */
  label: string;
  /**
   * Visual tone, gates color treatment.
   * - `neutral`: additive / navigation actions (new, expand, add)
   * - `danger`: destructive actions (remove, close, delete) — red foreground
   *   even at rest so the user can recognize destructiveness without
   *   hovering.
   */
  tone?: IconButtonTone;
  /**
   * Padding / hit-target size. `sm` ≈ 20px hit area for very dense rows,
   * `md` ≈ 24px (default) which satisfies the touch-target floor.
   */
  size?: IconButtonSize;
  /**
   * In-flight async state. Disables the button and dims it to communicate
   * that the click landed and is still resolving. P7.
   */
  busy?: boolean;
  /** The icon (typically an inline svg). */
  children: ReactNode;
}

const sizeClass: Record<IconButtonSize, string> = {
  // sm is for very dense rows (tree rows). Padding is p-1 around a ~10px
  // icon ≈ 18px hit area — denser than ideal but consistent with the
  // existing tree visual density.
  sm: "p-1 rounded",
  // md is the default for standalone buttons. p-1.5 around a ~12px icon
  // ≈ 24px hit area, satisfying the touch-target floor (P5).
  md: "p-1.5 rounded",
};

const toneClass: Record<IconButtonTone, string> = {
  neutral:
    "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]",
  // Danger tone: red foreground at rest (slightly muted), brighter on hover.
  // This satisfies P4: severity is recognizable without hover.
  danger:
    "text-red-400/70 hover:text-red-400 hover:bg-[var(--border)]",
};

/**
 * Standardized icon-only button used across the right panel. Encodes the
 * design principles: semantic <button>, ≥24px hit area at md, tone-coded
 * severity, required accessible label, async busy affordance.
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    {
      label,
      tone = "neutral",
      size = "md",
      busy = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || busy;
    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={isDisabled}
        {...rest}
        className={[
          "shrink-0 inline-flex items-center justify-center transition-colors",
          sizeClass[size],
          toneClass[tone],
          busy ? "opacity-60 cursor-progress" : "",
          isDisabled && !busy ? "opacity-40 cursor-not-allowed" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </button>
    );
  },
);
