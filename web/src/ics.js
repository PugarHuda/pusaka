// Calendar reminders for deadlines that cost real money if missed (a loan's due date, an heir's claim date):
// an RFC 5545 .ics with an alarm, and a Google Calendar link. Built in the browser; no server, no account.
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20261108T022801Z
const text = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// lines are folded at 75 octets (RFC 5545 §3.1); ponytail: counts UTF-16 units, fine for this ASCII-only text
const fold = (line) => line.match(/.{1,74}/g).join("\r\n ");

/** { uid, title, at (ms), details, url, alarmMin } -> .ics text, a 15-minute event at `at` with an alarm before it. */
export function ics({ uid, title, at, details, url, alarmMin = 24 * 60, now = Date.now() }) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pusaka//reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(at + 15 * 60_000)}`,
    `SUMMARY:${text(title)}`, `DESCRIPTION:${text(`${details}\n${url}`)}`, `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(title)}`, `TRIGGER:-PT${alarmMin}M`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

export const icsHref = (ev) => `data:text/calendar;charset=utf-8,${encodeURIComponent(ics(ev))}`;

export const googleHref = ({ title, at, details, url }) => "https://calendar.google.com/calendar/render?" + new URLSearchParams({
  action: "TEMPLATE", text: title, dates: `${stamp(at)}/${stamp(at + 15 * 60_000)}`, details: `${details}\n${url}`,
});
