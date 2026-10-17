// Public host API for plugins.
//
// The only module outside `./contracts` that plugins may import from the host
// (enforced by scripts/architecture-check.mjs). Everything re-exported here is
// a deliberate, stable surface: change a signature and every plugin feels it, so
// treat additions as API design, not convenience. Heavy DOCX/XLSX codecs are
// not part of this surface: they live inside plugins/documents-office/codecs,
// so a barrel here can never drag SheetJS into the main bundle.

export { FilterChip } from "../../components/filter-chip";
export { Meter } from "../../components/project-bits";
export { fromDateInput, toDateInput } from "../date-input";
export { documentIcon, formatBytes } from "../document-icons";
export { computeLinkOptions } from "../entity-link-options";
export { ENTITY_TYPE_LABEL } from "../entity-type-meta";
export { describeAuthError, describeError } from "../error-message";
export { buildImportRows, fileFingerprint, type ImportOptions, importRef, parseCsv } from "../finance-csv";
export { compareBreakdowns, topPayees, transactionsToCsv } from "../finance-insights";
export { assetShares, buildNetWorth, convertNetWorth } from "../finance-net-worth";
export { suggestRecurring } from "../finance-recurring-suggest";
export { buildForecast, dueState, plannedPayments } from "../finance-forecast";
export { withArchivedFallback } from "../finance-options";
export { parseQuickEntry, type QuickEntryDraft } from "../finance-quick-entry";
export { formatDayTitle, formatMoney, fromDatetimeLocal, fromKopecks, parseMoneyInput, projectColor, relativeTime, shortDate, shortDateTime, toDatetimeLocal, toKopecks } from "../format";
export { buildHeatmapWeeks, buildWeek, entryDaysByHabit, habitSwatchColor, streakLabel, type WeekDay, WEEKDAY_SHORT, weekdayTitle } from "../habit-days";
// `openEntity` is the one way to jump to a record; `focusTask` stays for existing callers.
export { focusTask, openEntity, openObject, openPanel } from "../panel-bus";
export { projectSwatchColor } from "../project-colors";
export { dayOffset, planDates, type PlanGroup, planGroups, type PlanRow, timelineRange, weekTicks } from "../project-plan";
export { daysUntil, type PlanStepState, planStrip, pluralDays } from "../project-status";
export { TASK_PRIORITY_LABEL, TASK_RECURRENCE_LABEL, TASK_STATUS_LABEL } from "../task-labels";
export { dailyTotals, localDayKey, periodStats, projectShares } from "../time-stats";
export { useUnsavedDraft } from "../unsaved-drafts";
export { useActiveWorkspace } from "../use-active-workspace";
export { useEnabledModules } from "../use-enabled-modules";
export { useLocalNow } from "../use-day-boundary";
