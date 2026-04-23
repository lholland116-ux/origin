"use client";

import {
  cloneElement,
  isValidElement,
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

export default function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>("top");
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0);

  function updatePosition() {
    const triggerEl = triggerRef.current;
    const tooltipEl = tooltipRef.current;

    if (!triggerEl || !tooltipEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;

    const nextPosition: TooltipPosition =
      spaceAbove < tooltipRect.height + 12 && spaceBelow > spaceAbove
        ? "bottom"
        : "top";

    setPosition(nextPosition);

    const centeredLeft = triggerRect.left + triggerRect.width / 2;
    const minLeft = tooltipRect.width / 2 + 8;
    const maxLeft = window.innerWidth - tooltipRect.width / 2 - 8;
    const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);

    setLeft(clampedLeft);
    setTop(nextPosition === "top" ? triggerRect.top : triggerRect.bottom);
  }

  useEffect(() => {
    if (!open) return;

    updatePosition();

    const handleWindowChange = () => updatePosition();

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open]);

  if (!isValidElement(children)) {
    return children;
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
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
            "pointer-events-none fixed z-[100] max-w-[220px] -translate-x-1/2 rounded-xl",
            "border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-xs text-white shadow-xl",
            position === "top" ? "-translate-y-2" : "translate-y-2",
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