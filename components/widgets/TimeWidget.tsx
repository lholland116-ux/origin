"use client";

import { useEffect, useState } from "react";

export default function TimeWidget({
  location,
  timezone,
}: {
  location: string;
  timezone: string;
}) {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
        })
      );
    };

    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [timezone]);

  return (
    <div className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-3xl font-semibold">{time}</div>
      <div className="text-xs text-neutral-400">{location}</div>
    </div>
  );
}