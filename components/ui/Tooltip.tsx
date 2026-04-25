"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
const TOOLTIP_MAX_WIDTH = 240;

export default function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>("top");
  const [left, setLeft] = useState(VIEWPORT_PADDING);
  const [top, setTop] = useState(VIEWPORT_PADDING);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const tooltipEl = tooltipRef.current;

    if (!triggerEl || !tooltipEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = window.visualViewport?.offsetLeft ?? 0;
    const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;

    const spaceAbove = triggerRect.top - viewportOffsetTop;
    const spaceBelow = viewportHeight - (triggerRect.bottom - viewportOffsetTop);

    const nextPosition: TooltipPosition =
      spaceAbove < tooltipRect.height + TOOLTIP_GAP + VIEWPORT_PADDING &&
      spaceBelow > spaceAbove
        ? "bottom"
        : "top";

    const preferredLeft =
      triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;

    const minLeft = viewportOffsetLeft + VIEWPORT_PADDING;
    const maxLeft =
      viewportOffsetLeft + viewportWidth - tooltipRect.width - VIEWPORT_PADDING;

    const nextLeft = Math.min(
      Math.max(preferredLeft, minLeft),
      Math.max(minLeft, maxLeft)
    );

    const nextTop =
      nextPosition === "top"
        ? triggerRect.top - tooltipRect.height - TOOLTIP_GAP
        : triggerRect.bottom + TOOLTIP_GAP;

    setPosition(nextPosition);
    setLeft(nextLeft);
    setTop(nextTop);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleWindowChange = () => {
      window.requestAnimationFrame(updatePosition);
    };

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    window.visualViewport?.addEventListener("resize", handleWindowChange);
    window.visualViewport?.addEventListener("scroll", handleWindowChange);

    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      window.visualViewport?.removeEventListener("resize", handleWindowChange);
      window.visualViewport?.removeEventListener("scroll", handleWindowChange);
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
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={(event) => {
        if (event.key === "Escape") hideTooltip();
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
            "pointer-events-none fixed z-[100]",
            "rounded-xl border border-zinc-700 bg-zinc-950",
            "px-3 py-2 text-center text-xs leading-relaxed text-white",
            "shadow-xl shadow-black/30",
          ].join(" ")}
          style={{
            left,
            top,
            maxWidth: TOOLTIP_MAX_WIDTH,
          }}
          data-position={position}
        >
          {content}
        </div>
      ) : null}
    </span>
  );
}