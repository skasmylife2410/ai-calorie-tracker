// morning-push.test.mjs — the morning job's check-in and weigh-in pushes: one a morning at most,
// the check-in first, and reminders that stop instead of nagging.
import test from "node:test";
import assert from "node:assert/strict";

const { morningPushFor, morningMessage, checkinDueAt, WEIGH_NOTICE_DAY } = await import("../api/weekly.js");
const DAY = 86400000;
const notice = "2000-01-01"; // keep the one-time notice out of the way

test("the check-in: the evening before, the day itself, and once more if it's still unopened", () => {
  const dueDay = "2026-10-21";
  const at = (today, weighDays = []) => morningPushFor({ today, dueDay, weighDays, noticeDay: notice })?.kind ?? null;
  assert.equal(at("2026-10-20"), "eve");
  assert.equal(at("2026-10-21"), "checkin");
  assert.equal(at("2026-10-23"), "checkin", "two days later, not opened yet");
  assert.equal(at("2026-10-22", ["2026-10-22"]), null);
  assert.equal(at("2026-10-24", ["2026-10-24"]), null, "no third reminder");
});

test("the week before: a countdown each morning without a weigh-in yet", () => {
  const p = morningPushFor({ today: "2026-10-15", dueDay: "2026-10-21", weighDays: ["2026-10-14"], noticeDay: notice });
  assert.deepEqual(p, { kind: "countdown", days: 6 });
  assert.equal(morningPushFor({ today: "2026-10-15", dueDay: "2026-10-21", weighDays: ["2026-10-15"], noticeDay: notice }), null, "already weighed in");
  assert.equal(morningMessage(p, { lang: "en" }).title, "6 days to your check-in");
  assert.equal(morningMessage(p, { lang: "es" }).url, "/?weighin=1");
});

test("a gap: every third day for three weeks, then it stops", () => {
  const kinds = [];
  for (let d = 1; d <= 26; d += 1) {
    const today = new Date(Date.parse("2026-10-01T12:00:00Z") + d * DAY).toISOString().slice(0, 10);
    const p = morningPushFor({ today, dueDay: "2026-12-30", weighDays: ["2026-10-01"], noticeDay: notice });
    if (p) kinds.push(`${p.kind}${p.days}`);
  }
  assert.deepEqual(kinds, ["gap3", "gap6", "gap9", "gap12", "gap15", "gap18", "gap21"]);
});

test("never weighed in: Monday mornings, once they've logged a meal", () => {
  assert.equal(morningPushFor({ today: "2026-10-16", weighDays: [], firstLogDay: "2026-09-13", noticeDay: notice }), null, "a Friday");
  assert.equal(morningPushFor({ today: "2026-10-19", weighDays: [], firstLogDay: null, noticeDay: notice }), null, "nothing logged yet");
  const p = morningPushFor({ today: "2026-10-19", weighDays: [], firstLogDay: "2026-09-13", noticeDay: notice });
  assert.deepEqual(p, { kind: "gap", never: true });
  assert.equal(morningMessage(p, { name: "Thayra", lang: "en" }).title, "Thayra, your first weigh-in is waiting");
});

test("the one-time notice, but the check-in still comes first", () => {
  assert.equal(morningPushFor({ today: WEIGH_NOTICE_DAY, weighDays: [WEIGH_NOTICE_DAY] })?.kind, "notice");
  assert.equal(morningPushFor({ today: WEIGH_NOTICE_DAY, dueDay: WEIGH_NOTICE_DAY })?.kind, "checkin");
});

test("the due date is worked out the way the app does", () => {
  const first = Date.parse("2026-09-21T12:00:00Z");
  assert.equal(checkinDueAt({ firstWeighAt: first }), first + 30 * DAY);
  assert.equal(checkinDueAt({ lastReviewAt: first, firstWeighAt: 1 }), first + 30 * DAY);
  assert.equal(checkinDueAt({ nextReviewAt: first + 7 * DAY, lastReviewAt: first }), first + 7 * DAY, "snoozed a week for weigh-ins");
  assert.equal(checkinDueAt({}), null);
});
