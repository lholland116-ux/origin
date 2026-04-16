"use client";

import { ReactNode, useId, useState } from "react";

type TooltipSide = "top" | "bottom";

type TooltipProps = {
  content: string;
  children: ReactNode;
  side?: TooltipSide;
  disabled?: boolean;
};

export default function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const trimmedContent = content.trim();
  const shouldRenderTooltip = !disabled && trimmedContent.length > 0;

  const positionClasses =
    side === "bottom"
      ? "top-full left-1/2 mt-2 -translate-x-1/2"
      : "bottom-full left-1/2 mb-2 -translate-x-1/2";

  function showTooltip() {
    if (!shouldRenderTooltip) return;
    setOpen(true);
  }

  function hideTooltip() {
    setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <span aria-describedby={open && shouldRenderTooltip ? tooltipId : undefined}>
        {children}
      </span>

      {open && shouldRenderTooltip ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute z-50 max-w-xs whitespace-normal rounded-lg bg-zinc-900 px-3 py-1.5 text-center text-xs leading-5 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900 ${positionClasses}`}
        >
          {trimmedContent}
        </span>
      ) : null}
    </span>
  );
}