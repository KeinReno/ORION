"use client";

import { Button, Select, Skeleton, useToast } from "@orion/ui";
import { useEffect, useState } from "react";
import { api } from "../../lib/compass/api";
import type { AiProviderId, Settings } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

/** Настройки движка Compass: поиск сигналов, таймфреймы, биржа крипты, AI. Хранятся в данных Compass этого пространства. */
export function CompassSettingsTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const settings = useCompassQuery(workspaceId, ["settings"], () => api.settings());
  const strategies = useCompassQuery(workspaceId, ["strategies"], () => api.strategies());
  const exchanges = useCompassQuery(workspaceId, ["crypto-exchanges"], () => api.cryptoExchanges());
  const providers = useCompassQuery(workspaceId, ["ai-providers"], () => api.aiProviders());
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  if (!draft) return <Skeleton className="h-40" />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setDraft({ ...draft, [key]: value });
  const provider = providers.data?.find((item) => item.id === draft.ai_provider);

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    try {
      await api.saveSettings({
        scan_interval_min: draft.scan_interval_min,
        tf_moex: draft.tf_moex,
        tf_crypto: draft.tf_crypto,
        default_strategy: draft.default_strategy,
        scan_all_strategies: draft.scan_all_strategies,
        signal_valid_bars: draft.signal_valid_bars,
        quiet_hours: draft.quiet_hours,
        crypto_exchange: draft.crypto_exchange,
        crypto_fallback: draft.crypto_fallback,
        ai_provider: draft.ai_provider,
        // Согласие на отправку данных облачному AI — только осознанным флажком ниже, не побочным эффектом сохранения.
        ai_consent: draft.ai_consent
      });
      await invalidate();
      toast({ title: "Настройки Compass сохранены", tone: "success" });
    } catch (error) {
      toast({ title: "Не сохранилось", description: describeAuthError(error), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Group title="Поиск сигналов">
        <Row label="Проверять каждые, мин">
          <input type="number" min="1" max="1440" aria-label="Проверять каждые, мин" value={draft.scan_interval_min} onChange={(event) => set("scan_interval_min", Number(event.target.value))} className={inputClass} />
        </Row>
        <Row label="Таймфрейм МосБиржи">
          <Select aria-label="Таймфрейм МосБиржи" value={draft.tf_moex} onChange={(event) => set("tf_moex", event.target.value)} className="w-28">
            {["1h", "1d"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </Row>
        <Row label="Таймфрейм крипты">
          <Select aria-label="Таймфрейм крипты" value={draft.tf_crypto} onChange={(event) => set("tf_crypto", event.target.value)} className="w-28">
            {["15m", "1h", "4h", "1d"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </Row>
        <Row label="Правило по умолчанию">
          <Select aria-label="Правило по умолчанию" value={draft.default_strategy} onChange={(event) => set("default_strategy", event.target.value)} className="w-72">
            {(strategies.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Искать по всем правилам">
          <input type="checkbox" aria-label="Искать по всем правилам" checked={draft.scan_all_strategies} onChange={(event) => set("scan_all_strategies", event.target.checked)} />
        </Row>
        <Row label="Сигнал актуален, свечей">
          <input type="number" min="1" max="50" aria-label="Сигнал актуален, свечей" value={draft.signal_valid_bars} onChange={(event) => set("signal_valid_bars", Number(event.target.value))} className={inputClass} />
        </Row>
        <Row label="Тихие часы">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.quiet_hours.enabled} onChange={(event) => set("quiet_hours", { ...draft.quiet_hours, enabled: event.target.checked })} />
            <input type="time" aria-label="Тихие часы с" value={draft.quiet_hours.from} onChange={(event) => set("quiet_hours", { ...draft.quiet_hours, from: event.target.value })} className={inputClass} />
            —
            <input type="time" aria-label="Тихие часы до" value={draft.quiet_hours.to} onChange={(event) => set("quiet_hours", { ...draft.quiet_hours, to: event.target.value })} className={inputClass} />
          </label>
        </Row>
      </Group>

      <Group title="Крипта">
        <Row label="Основная биржа">
          <Select aria-label="Основная биржа" value={draft.crypto_exchange} onChange={(event) => set("crypto_exchange", event.target.value)} className="w-40">
            {(exchanges.data?.options ?? [draft.crypto_exchange]).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </Row>
        <Row label="Запасная биржа">
          <Select aria-label="Запасная биржа" value={draft.crypto_fallback} onChange={(event) => set("crypto_fallback", event.target.value)} className="w-40">
            <option value="">нет</option>
            {(exchanges.data?.options ?? []).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </Row>
      </Group>

      <Group title="AI-пояснения">
        <Row label="Провайдер">
          <Select aria-label="Провайдер AI" value={draft.ai_provider} onChange={(event) => set("ai_provider", event.target.value as AiProviderId)} className="w-56">
            <option value="off">Выключен</option>
            {(providers.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.cloud ? " (облако)" : " (локально)"}
              </option>
            ))}
          </Select>
        </Row>
        {provider?.cloud ? (
          <Row label="Согласие">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.ai_consent === provider.id} onChange={(event) => set("ai_consent", event.target.checked ? provider.id : "")} />
              Разрешаю отправлять расчёты (не ключи и не пароли) облачному сервису «{provider.name}»
            </label>
          </Row>
        ) : null}
      </Group>

      <div>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

const inputClass = "w-24 rounded-lg border border-border bg-white/[0.03] px-2 py-1 text-sm text-foreground";

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-3" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-52 text-label text-subtle-foreground">{label}</span>
      {children}
    </div>
  );
}
