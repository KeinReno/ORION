"use client";

import { useClearAssistantKey, useSaveAssistantKey, useSetAssistantModel } from "@orion/core-react";
import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_MODELS } from "@orion/shared-types";
import { Button, Input, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { ChoiceSelect } from "../components/choice-select";
import { describeAuthError } from "../lib/error-message";

const OTHER = "__other";

/**
 * The assistant's model: one of the offered ones or any other id. Used by the key form and, for a saved key, on its
 * own («Сменить модель» without entering the key again).
 */
function ModelField({ value, onChange }: { value: string; onChange: (model: string) => void }): React.ReactElement {
  const known = ASSISTANT_MODELS.some((model) => model.id === value);
  const [custom, setCustom] = useState(!known);
  const hint = ASSISTANT_MODELS.find((model) => model.id === value)?.hint;
  return (
    <div className="space-y-1">
      <ChoiceSelect
        label="Модель"
        value={custom ? OTHER : value}
        options={[
          ...ASSISTANT_MODELS.map((model) => ({ value: model.id, label: model.label })),
          { value: OTHER, label: "Другая — указать id" }
        ]}
        onChange={(next) => {
          if (next === OTHER) return setCustom(true);
          setCustom(false);
          onChange(next);
        }}
      />
      {custom ? <Input aria-label="id модели" value={value} onChange={(event) => onChange(event.target.value)} placeholder="claude-…" /> : null}
      {hint && !custom ? <p className="text-2xs text-subtle-foreground">{hint}</p> : null}
    </div>
  );
}

/** First connection: the user's own Anthropic API key (the subscription is not usable from ORION's own chat). */
export function AssistantKeyForm(): React.ReactElement {
  const save = useSaveAssistantKey();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(ASSISTANT_DEFAULT_MODEL);
  const { toast } = useToast();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await save.mutateAsync({ apiKey, model });
      setApiKey("");
      toast({ title: "Ключ сохранён", description: "Он хранится зашифрованным на этом узле и больше не показывается.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить ключ", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-md space-y-3">
      <p className="text-xs text-muted-foreground">
        Нужен ваш API-ключ Anthropic (console.anthropic.com → API Keys; оплачивается отдельно от подписки Claude). ORION хранит
        его зашифрованным только на этом компьютере и использует лишь для вашего чата. Сообщения и данные, которые ассистент
        читает по вашей просьбе, уходят провайдеру модели. Агенты по вашей подписке (Claude Desktop, Claude Code)
        подключаются на вкладке «Подключения».
      </p>
      <label className="block space-y-1 text-sm">
        <span>API-ключ</span>
        <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-ant-…" />
      </label>
      <div className="space-y-1 text-sm">
        <span>Модель</span>
        <ModelField value={model} onChange={setModel} />
      </div>
      <Button type="submit" disabled={apiKey.trim().length < 20 || save.isPending}>
        Сохранить ключ
      </Button>
    </form>
  );
}

/** A saved key: change the model in place. */
export function AssistantModelPicker({ current }: { current: string }): React.ReactElement {
  const setModel = useSetAssistantModel();
  const [model, setLocal] = useState(current);
  const { toast } = useToast();
  return (
    <div className="flex max-w-md flex-wrap items-start gap-2">
      <div className="min-w-[16rem] flex-1">
        <ModelField value={model} onChange={setLocal} />
      </div>
      <Button
        size="sm"
        disabled={model.trim() === "" || model === current || setModel.isPending}
        onClick={() =>
          void setModel.mutateAsync(model.trim()).then(
            () => toast({ title: "Модель сменена", tone: "success" }),
            (error) => toast({ title: "Не удалось сменить модель", description: describeAuthError(error), tone: "danger" })
          )
        }
      >
        Сменить модель
      </Button>
    </div>
  );
}

export function ClearAssistantKeyButton(): React.ReactElement {
  const clear = useClearAssistantKey();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={clear.isPending}
      onClick={() =>
        void clear.mutateAsync().then(
          () => toast({ title: "Ключ удалён", tone: "success" }),
          (error) => toast({ title: "Не удалось удалить ключ", description: describeAuthError(error), tone: "danger" })
        )
      }
    >
      Удалить ключ
    </Button>
  );
}
