import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Mic } from "lucide-react";
import { z } from "zod";

const resultSchema = z.object({ id: z.string().default(""), text: z.string().max(50000).default(""), durable: z.boolean().default(true), cancelled: z.boolean().optional() });
type Result = z.infer<typeof resultSchema>;
const Speech = registerPlugin<{
  recognize(): Promise<unknown>; getPending(): Promise<unknown>; acknowledge(options: { id: string }): Promise<void>;
}>("OrionSpeech");
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось открыть диктовку. Попробуйте ещё раз.";

export function Dictation({ disabled, apply, prepare, activity }: {
  disabled: boolean; prepare: () => Promise<void>;
  apply: (text: string, field: "title" | "body", id: string) => Promise<void>;
  activity: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    void Speech.getPending().then((raw) => { const result = resultSchema.parse(raw); if (alive && result.id && result.text) setPending(result); })
      .catch(() => { if (alive) setError("Не удалось прочитать незавершённую диктовку. Попробуйте открыть редактор ещё раз."); });
    return () => { alive = false; };
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true); activity(true); setError(""); setNotice("");
    try { await work(); } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); activity(false); }
  }
  return <section className="dictation" aria-label="Голосовой ввод">
    {!pending ? <>
      <button type="button" disabled={disabled || busy} onClick={() => void run(async () => {
        if (!Capacitor.isNativePlatform()) throw new Error("Системная диктовка доступна в Android-приложении.");
        await prepare();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const result = resultSchema.parse(await Speech.recognize());
        if (result.cancelled) { setNotice("Диктовка отменена. Черновик сохранён."); return; }
        if (!result.id || !result.text) throw new Error("Речь не распознана. Повторите диктовку.");
        setPending(result);
      })}><Mic size={20} />{busy ? "Открыта системная диктовка…" : "Надиктовать"}</button>
      <p className="helper">Без клавиатуры · русский язык. Системный сервис Android может использовать интернет.</p>
    </> : <div className="dictation-result">
      <h2>Распознанный текст</h2><p className="helper">Выберите, куда добавить его в текущем черновике. Существующий текст останется.</p>
      <textarea aria-label="Распознанный текст" readOnly rows={4} value={pending.text} />
      {!pending.durable && <p className="error">Результат не удалось записать отдельно. Добавьте его в черновик до закрытия приложения.</p>}
      <div className="dictation-actions">{(["title", "body"] as const).map((field) => <button type="button" key={field} disabled={disabled || busy}
        onClick={() => void run(async () => {
          await apply(pending.text, field, pending.id);
          await Speech.acknowledge({ id: pending.id });
          setPending(null); setNotice("Диктовка добавлена в черновик. Проверьте текст перед сохранением.");
        })}>{field === "title" ? "Добавить в название" : "Добавить в текст"}</button>)}
        <button type="button" className="text-button" disabled={disabled || busy} onClick={() => void run(async () => {
          await Speech.acknowledge({ id: pending.id }); setPending(null); setNotice("Результат диктовки отменён. Текст черновика сохранён.");
        })}>Отменить диктовку</button></div>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="helper" role="status">{notice}</p>}
  </section>;
}
