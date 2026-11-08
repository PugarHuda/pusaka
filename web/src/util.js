import { useEffect, useState } from "react";

/** The clock as state, ticking every `ms` while `on`: render reads it instead of calling Date.now(). */
export function useNow(ms = 1000, on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

/** A short burst of Bitcoin-orange and lavender when something lands (a purchase, a claim, an inheritance). */
export function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  box.setAttribute("aria-hidden", "true");
  const colors = ["#f7931a", "#ffd77a", "#b48cf0", "#a9c98b", "#57bcee"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 120}vw`);
    p.style.setProperty("--y", `${60 + Math.random() * 50}vh`);
    p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.15}s`;
    if (i % 3 === 0) p.style.borderRadius = "50%";
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}

/** Pusakas you're keeping an eye on, kept in this browser only. */
export const WATCH_KEY = "pusaka:watch";
export const watched = () => new Set(JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]"));
