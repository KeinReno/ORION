import { useEffect, useState } from "react";
import { Check, Copy, Download, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import type { MobileSnapshot } from "@orion/mobile-core";
import type { useLan } from "./use-lan";
import { ANDROID_RELEASE_LABEL, ANDROID_VERSION } from "./updates";

function ChangedFields({ fields }: { fields: Record<string, unknown> }) {
  const names: Record<string, string> = { title: "Название", body: "Текст", description: "Описание", status: "Состояние", priority: "Приоритет",
    dueAt: "Срок", startAt: "Начало", estimatedMinutes: "План, минут", sortOrder: "Порядок", summary: "Краткое описание", tags: "Теги",
    pinnedAt: "Закрепление", archivedAt: "Архив", eventAt: "Дата" };
  const values: Record<string, string> = { todo: "К выполнению", backlog: "Отложено", in_progress: "В работе", done: "Завершено", canceled: "Отменено", low: "Низкий", normal: "Обычный", high: "Высокий" };
  return <dl className="changed-fields">{Object.entries(fields).map(([key, value]) => <div key={key}>
    <dt>{names[key] ?? "Свойство записи"}</dt><dd>{value == null ? "Не задано" : Array.isArray(value) ? value.join(", ") : values[String(value)] ?? String(value)}</dd>
  </div>)}</dl>;
}
export function ConnectionPage({ data, connection, address, port, setAddress, setPort, saveProfile, backup, busy }: {
  data: MobileSnapshot; connection: ReturnType<typeof useLan>;
  address: string; port: string; setAddress: (value: string) => void; setPort: (value: string) => void;
  saveProfile: () => void; backup: () => void; busy: boolean;
}) {
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const state = connection.state;
  const selectedAccount = connection.accounts.find((item) => item.id === account);
  const pin = selectedAccount?.unlockKind === "pin";
  const backupCurrent = data.lastBackupSeq === data.deviceSeq;
  const client = connection.client;
  const status = client?.engine.status();
  const blocked = busy || connection.busy;
  useEffect(() => { if (state?.user) setPassword(""); }, [state?.user]);
  return <section className="connection">
    <section className="settings-section">
      <h2>Резервная копия</h2>
      <p>Сохраните задачи, заметки и черновики в JSON перед первым переносом на компьютер.</p>
      <button onClick={backup} disabled={blocked}><Download size={18} />Сохранить резервную копию</button>
      <p className="helper">{backupCurrent ? "Текущая версия записей телефона экспортирована." : "После изменения записей понадобится новая копия."}</p>
    </section>
    {connection.error && <p className="error" role="alert">{connection.error}</p>}
    {connection.message && <p className="notice" role="status">{connection.message}</p>}
    {!state?.paired ? <section className="settings-section">
      <h2>Подключить компьютер</h2>
      <p>В Orion на ПК включите «Хост LAN». Введите его адрес и порт. Телефон и ПК должны находиться в одной сети.</p>
      <form onSubmit={(e) => { e.preventDefault(); saveProfile(); }}>
        <label>Адрес компьютера<input value={address} placeholder="192.168.1.20" autoCapitalize="none" autoCorrect="off" onChange={(e) => setAddress(e.target.value)} /></label>
        <label>Порт<input type="number" inputMode="numeric" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <button disabled={blocked}>Сохранить профиль</button>
      </form>
      {connection.pairing?.status === "pending" ? <div className="pair-code">
        <h3>Подтвердите телефон на ПК</h3>
        <p>Введите этот код в заявке на компьютере. Если он не принимается, не подтверждайте другое устройство.</p>
        <strong aria-label={"Код сопряжения " + connection.pairing.code.split("").join(" ")}>{connection.pairing.code}</strong>
        <p>{connection.pairing.node.name} · ожидаем подтверждения</p>
        <button disabled={blocked} onClick={() => void connection.poll()}><RefreshCw size={18} />Проверить подтверждение</button>
      </div> : <button className="primary" disabled={blocked || !address.trim() || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535}
        onClick={() => void connection.begin(address, Number(port))}><Link2 size={18} />Запросить подключение</button>}
    </section> : <>
      <section className="settings-section"><h2><ShieldCheck size={20} /> {state.node?.name ?? "Компьютер подключён"}</h2>
        <p>Доверие к компьютеру закреплено его сертификатом.</p>
        {!state.user ? <form onSubmit={(e) => {
          e.preventDefault();
          const credentials: Record<string, string> = {};
          if (selectedAccount) { credentials.userId = selectedAccount.id; credentials[pin ? "pin" : "password"] = password; }
          else { credentials.email = email; credentials.password = password; }
          void connection.login(credentials);
        }}>
          {connection.accounts.length > 0 && <label>Учётная запись<select value={account} onChange={(e) => { setAccount(e.target.value); setPassword(""); }}>
            <option value="">Войти по имени или email</option>{connection.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          {!selectedAccount && <label>Имя или email<input value={email} autoComplete="username" autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} /></label>}
          <label>{pin ? "PIN учётной записи" : "Пароль"}<input type="password" inputMode={pin ? "numeric" : "text"} autoComplete="current-password"
            value={password} maxLength={pin ? 4 : 128} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary" disabled={blocked || !password || (!selectedAccount && !email.trim())}>Войти на компьютере</button>
        </form> : <>
          <p>Учётная запись: {state.user.name}</p>
          <h3>Пространства компьютера</h3>
          <p className="helper">Для офлайн-правок включите гибридный режим нужного пространства на ПК.</p>
          {connection.workspaces.length ? <ul className="workspace-list">{connection.workspaces.map((space) => <li key={space.id}>
            <button disabled={blocked} onClick={() => void connection.connect(space)}>
              <span>{space.name}<small>{space.isPersonal ? "Личное" : "Общее"} · {space.role === "owner" ? "Владелец" : space.role === "lead" ? "Руководитель" : "Участник"}</small></span>
              {data.remoteSelection?.workspaceId === space.id && <Check size={18} />}
            </button></li>)}</ul> : <p>Список пока не загружен или доступных пространств нет.</p>}
          <button disabled={blocked} onClick={() => void connection.reloadWorkspaces()}>Обновить список пространств</button>
        </>}
      </section>
      {client && data.remoteSelection && <section className="settings-section">
        <h2>{data.remoteSelection.workspaceName}</h2>
        <div className="space-choice">
          <button aria-pressed={!data.remoteActive} disabled={blocked} onClick={() => void connection.switchSpace(false)}>На телефоне</button>
          <button aria-pressed={data.remoteActive} disabled={blocked} onClick={() => void connection.switchSpace(true)}>Пространство ПК</button>
        </div>
        <p>{status?.phase === "offline" ? "Нет связи с компьютером. Правки сохраняются на телефоне."
          : status?.phase === "syncing" ? "Обмениваемся изменениями…" : status?.asOf ? "Последний ответ ПК: " + new Date(status.asOf).toLocaleString("ru-RU") : "Копия ещё не подтверждена."}</p>
        <p className="helper">В очереди: {status?.pending ?? 0}. Конфликтов: {status?.conflicts ?? 0}.</p>
        <button className="primary" disabled={blocked || status?.phase === "syncing"} onClick={() => void connection.sync()}><RefreshCw size={18} />Синхронизировать</button>
        <h3>Скопировать записи телефона</h3>
        <p>Задач: {data.tasks.length}. Заметок: {data.notes.length}. Оригиналы останутся в разделе «На телефоне».</p>
        <label className="ack-row"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>Скопировать в «{data.remoteSelection.workspaceName}». Участники этого пространства смогут видеть копии согласно своим правам.</span></label>
        {!backupCurrent && <p className="helper">Сначала сохраните актуальную резервную копию кнопкой выше.</p>}
        <button disabled={blocked || !backupCurrent || !acknowledged || !(data.tasks.length + data.notes.length)}
          onClick={() => { void connection.importLocal(); setAcknowledged(false); }}><Copy size={18} />Скопировать записи в пространство</button>
        {client.engine.conflicts().length > 0 && <div className="conflicts">
          <h3>Конфликты изменений</h3><p>Сравните свою правку с текущей записью. «Моя правка» применится поверх версии ПК после новой синхронизации.</p>
          {client.engine.conflicts().map((conflict) => <section key={conflict.opId}>
            <h4>{String(conflict.op.fields?.title ?? "Изменённая запись")} — правка требует решения</h4>
            <details><summary>Моя правка</summary><ChangedFields fields={conflict.op.fields ?? {}} /></details>
            <details><summary>Версия компьютера</summary>{client.engine.entities()[conflict.op.entity][conflict.op.entityId]
              ? <ChangedFields fields={Object.fromEntries(Object.keys(conflict.op.fields ?? {}).map((key) => [key, client.engine.entities()[conflict.op.entity][conflict.op.entityId]?.[key]]))} />
              : <p>Запись больше недоступна.</p>}</details>
            <p className="helper">Если оставить версию ПК, ваша правка будет убрана из списка конфликтов. Её можно предварительно сохранить экспортом.</p>
            <button disabled={blocked} onClick={() => void connection.resolveConflict(conflict.opId, true)}>Повторить мою правку</button>
            <button disabled={blocked} onClick={() => void connection.resolveConflict(conflict.opId, false)}>Оставить версию ПК</button>
          </section>)}
        </div>}
      </section>}
      <section className="settings-section">
        <button className="text-button" onClick={() => setDisconnect((value) => !value)}>Отключение и выход</button>
        {disconnect && <div><p>Копии пространств и их неотправленные изменения будут удалены с этого телефона. Сначала экспортируйте нужные записи. Раздел «На телефоне» сохранится.</p>
          {state.user && <button disabled={blocked} onClick={() => void connection.disconnect(false)}>Выйти и удалить копии ПК</button>}
          <button disabled={blocked} onClick={() => void connection.disconnect(true)}>Отключить ПК и удалить его копии</button>
        </div>}
      </section>
    </>}
    <dl><div><dt>Локальные операции телефона</dt><dd>{data.outbox.length}</dd></div><div><dt>Версия</dt><dd>{ANDROID_VERSION} · {ANDROID_RELEASE_LABEL}</dd></div></dl>
  </section>;
}
