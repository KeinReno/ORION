import { Injectable, Logger } from "@nestjs/common";
import type { BackgroundJobStatus } from "@orion/shared-types";

/** Сколько символов сообщения об ошибке храним: хватает для диагностики и не раздувает ответ. */
const MAX_ERROR_LENGTH = 300;

interface JobState {
  componentId: string;
  jobName: string;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
  /** Foundation Core: запусков, пропущенных потому, что компонент выключен в пространстве. */
  paused: number;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

/**
 * G9 — изоляция сбоев фоновых задач. Все крон-службы живут в одном процессе, и
 * необработанное исключение одной из них не должно ни ронять процесс, ни
 * оставлять след только в логе: каждая `@Cron`-точка входа идёт через
 * `runJob(componentId, jobName, fn)`. Обёртка никогда не бросает наружу,
 * не даёт одной и той же задаче наложиться на саму себя (минутный крон, не
 * успевший за минуту, иначе удвоил бы уведомления) и ведёт счётчики по
 * (componentId, jobName) для `GET system/jobs`. Состояние — в памяти:
 * это диагностика текущего процесса, а не журнал, после перезапуска она пуста.
 */
@Injectable()
export class BackgroundJobsService {
  private readonly logger = new Logger(BackgroundJobsService.name);
  private readonly jobs = new Map<string, JobState>();

  /** Возвращает `true`, если задача выполнилась без ошибки; `false` — сбой или пропуск из-за наложения. */
  async runJob(componentId: string, jobName: string, fn: () => Promise<unknown>): Promise<boolean> {
    const state = this.stateFor(componentId, jobName);
    if (state.running) {
      state.skipped += 1;
      this.logger.warn(`${componentId}/${jobName}: предыдущий запуск ещё идёт, текущий пропущен`);
      return false;
    }
    state.running = true;
    state.runs += 1;
    state.lastStartedAt = new Date();
    try {
      await fn();
      state.lastSuccessAt = new Date();
      state.lastError = null;
      return true;
    } catch (error) {
      state.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message.slice(0, MAX_ERROR_LENGTH);
      this.logger.error(`${componentId}/${jobName}: ${message}`, error instanceof Error ? error.stack : undefined);
      return false;
    } finally {
      state.running = false;
      state.lastFinishedAt = new Date();
    }
  }

  /** Отметить пропуск из-за выключенного компонента (Foundation Core): задача не падала, а была поставлена на паузу. */
  markPaused(componentId: string, jobName: string): void {
    this.stateFor(componentId, jobName).paused += 1;
  }

  /** Снимок для диагностического эндпоинта: только имена, счётчики, время и текст последней ошибки. */
  list(): BackgroundJobStatus[] {
    return [...this.jobs.values()]
      .map((s) => ({
        componentId: s.componentId,
        jobName: s.jobName,
        running: s.running,
        runs: s.runs,
        failures: s.failures,
        skipped: s.skipped,
        paused: s.paused,
        lastStartedAt: s.lastStartedAt?.toISOString() ?? null,
        lastFinishedAt: s.lastFinishedAt?.toISOString() ?? null,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
        lastError: s.lastError
      }))
      .sort((a, b) => a.componentId.localeCompare(b.componentId) || a.jobName.localeCompare(b.jobName));
  }

  private stateFor(componentId: string, jobName: string): JobState {
    const key = `${componentId}/${jobName}`;
    let state = this.jobs.get(key);
    if (!state) {
      state = {
        componentId,
        jobName,
        running: false,
        runs: 0,
        failures: 0,
        skipped: 0,
        paused: 0,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        lastError: null
      };
      this.jobs.set(key, state);
    }
    return state;
  }
}
