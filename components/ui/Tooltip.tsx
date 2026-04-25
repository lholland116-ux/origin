"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
} from "react";

type TooltipProps = {
  content: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
};

type TooltipPosition = "top" | "bottom";

const VIEWPORT_PADDING = 12;
const TOOLTIP_GAP = 10;

export default function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>("top");
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const tooltipEl = tooltipRef.current;

    if (!triggerEl || !tooltipEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;

    const nextPosition: TooltipPosition =
      spaceAbove < tooltipRect.height + TOOLTIP_GAP + VIEWPORT_PADDING &&
      spaceBelow > spaceAbove
        ? "bottom"
        : "top";

    const centeredLeft = triggerRect.left + triggerRect.width / 2;
    const minLeft = VIEWPORT_PADDING + tooltipRect.width / 2;
    const maxLeft =
      window.innerWidth - VIEWPORT_PADDING - tooltipRect.width / 2;

    const clampedLeft = Math.min(
      Math.max(centeredLeft, minLeft),
      Math.max(minLeft, maxLeft)
    );

    const nextTop =
      nextPosition === "top"
        ? triggerRect.top - TOOLTIP_GAP
        : triggerRect.bottom + TOOLTIP_GAP;

    setPosition(nextPosition);
    setLeft(clampedLeft);
    setTop(nextTop);
  }, []);

  useEffect(() => {
    if (!open) return;

    const animationFrameId = window.requestAnimationFrame(updatePosition);

    const handleWindowChange = () => {
      window.requestAnimationFrame(updatePosition);
    };

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, updatePosition]);

  if (!isValidElement(children)) {
    return children;
  }

  const showTooltip = () => {
    if (content.trim()) setOpen(true);
  };

  const hideTooltip = () => {
    setOpen(false);
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          hideTooltip();
        }
      }}
    >
      {cloneElement(children, {
        "aria-describedby": open ? id : undefined,
      })}

      {open ? (
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={[
            "pointer-events-none fixed z-[100] max-w-[240px] rounded-xl",
            "border border-zinc-700 bg-zinc-950 px-3 py-2 text-center text-xs leading-relaxed text-white shadow-xl shadow-black/30",
            "-translate-x-1/2",
            position === "top" ? "-translate-y-full" : "translate-y-0",
          ].join(" ")}
          style={{
            left,
            top,
          }}
        >
          {content}
        </div>
      ) : null}
    </span>
  );
}