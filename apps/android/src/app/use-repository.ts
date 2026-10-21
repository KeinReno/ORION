import { useEffect, useRef, useState } from "react";
import { MobileRepository, type MobileSnapshot } from "@orion/mobile-core";
import { storage } from "../storage";

export function useRepository() {
  const repo = useRef<MobileRepository | null>(null);
  const working = useRef(false);
  const [data, setData] = useState<MobileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function open() {
    setLoading(true); setError("");
    try { repo.current = await MobileRepository.open(storage); setData(repo.current.snapshot()); }
    catch { setError("Не удалось открыть локальные данные. Они не удалены. Повторите открытие; если ошибка остаётся, сохраните данные приложения для восстановления."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void open(); }, []);
  async function action(work: (value: MobileRepository) => Promise<void>, message: string) {
    if (!repo.current || working.current || busy) return false;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(repo.current); setData(repo.current.snapshot()); setNotice(message); return true; }
    catch (value) { setError(value instanceof Error && !("issues" in value) ? value.message : "Не удалось сохранить. Проверьте ввод и повторите — введённый текст остаётся здесь."); return false; }
    finally { working.current = false; setBusy(false); }
  }
  return { repo, data, setData, loading, busy, setBusy, error, setError, notice, setNotice, open, action };
}
