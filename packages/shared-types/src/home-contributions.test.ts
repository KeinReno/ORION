import { describe, expect, it } from "vitest";
import { buildContributions, contributionWeekStart, type ContributionTask } from "./home-contributions";

const now = new Date("2026-10-15T12:00:00.000Z");
const members = [
  { userId: "a", name: "Аня" },
  { userId: "b", name: "Борис" }
];
const done = (closer: string | null, assignee: string | null, daysAgo: number, minutes: number | null = null): ContributionTask => ({
  status: "done",
  completedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  dueAt: null,
  assigneeUserId: assignee,
  closerUserId: closer,
  minutes
});
const open = (assignee: string | null, dueAt: string | null = null): ContributionTask => ({
  status: "todo",
  completedAt: null,
  dueAt,
  assigneeUserId: assignee,
  closerUserId: null,
  minutes: null
});

describe("buildContributions", () => {
  it("делит закрытые дела по тем, кто закрыл, и доли вместе с неопределёнными дают 1", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [done("a", "a", 1), done("a", null, 2), done("b", "b", 3), done(null, "b", 4)] });
    expect(out.totalDone).toBe(4);
    expect(out.undetermined).toBe(1);
    const a = out.members.find((m) => m.userId === "a")!;
    expect(a.done).toBe(2);
    expect(a.share).toBe(0.5);
    const sum = out.members.reduce((s, m) => s + m.share, 0) + out.undetermined / out.totalDone;
    expect(sum).toBeCloseTo(1);
  });

  it("отличает «взял чужое» от своего и от неназначенного", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [done("a", "b", 1), done("a", "a", 1), done("a", null, 1)] });
    const a = out.members.find((m) => m.userId === "a")!;
    expect(a.takenOver).toBe(1);
    expect(a.doneOwn).toBe(2);
  });

  it("не считает дела вне окна и не закрытые done", () => {
    const out = buildContributions({ period: "week", now, members, tasks: [done("a", "a", 10), done("a", "a", 1), { ...open("a"), status: "canceled" }] });
    expect(out.totalDone).toBe(1);
  });

  it("вышедший участник и нулевой знаменатель не ломают расчёт", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [done("gone", "a", 1)] });
    expect(out.undetermined).toBe(1);
    expect(out.members.every((m) => m.share === 0)).toBe(true);
    expect(buildContributions({ period: "month", now, members, tasks: [] }).members.every((m) => m.share === 0 && m.minutesShare === 0)).toBe(true);
  });

  it("считает минуты только у тех дел, где они известны, и неизвестные не равны нулю в доле", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [done("a", "a", 1, 30), done("b", "b", 1, 90), done("b", "b", 2, null)] });
    expect(out.totalMinutes).toBe(120);
    expect(out.members.find((m) => m.userId === "a")!.minutesShare).toBeCloseTo(0.25);
    expect(out.members.find((m) => m.userId === "b")!.done).toBe(2);
  });

  it("открытые: назначенные, просроченные и ничьи", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [open("a", "2026-10-01T00:00:00.000Z"), open("a", "2027-01-01T00:00:00.000Z"), open(null)] });
    const a = out.members.find((m) => m.userId === "a")!;
    expect(a.openAssigned).toBe(2);
    expect(a.overdue).toBe(1);
    expect(out.openUnassigned).toBe(1);
  });

  it("недели идут подряд с понедельника и включают пустые", () => {
    const out = buildContributions({ period: "month", now, members, tasks: [done("a", "a", 1)] });
    expect(out.weeks[0].start).toBe(contributionWeekStart(new Date(out.from)));
    expect(out.weeks[out.weeks.length - 1].start).toBe("2026-10-12");
    expect(out.weeks[out.weeks.length - 1].counts).toEqual({ a: 1 });
    expect(out.weeks.length).toBeGreaterThanOrEqual(5);
  });
});

describe("contributionWeekStart", () => {
  it("воскресенье относится к неделе, начавшейся в понедельник раньше", () => {
    expect(contributionWeekStart(new Date("2026-10-18T10:00:00.000Z"))).toBe("2026-10-12");
    expect(contributionWeekStart(new Date("2026-10-12T00:00:00.000Z"))).toBe("2026-10-12");
  });
});
