import { Capacitor } from "@capacitor/core";
import { DepthCard } from "./depth-card";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Link2, RefreshCw, ShieldCheck, Monitor } from "lucide-react";
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
  const discover = connection.discover;
  useEffect(() => { if (Capacitor.isNativePlatform()) void discover(); }, [discover]);
  const stepHeading = useRef<HTMLHeadingElement>(null);
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
  const step = !state?.paired ? connection.pairing?.status === "pending" ? 2 : 1 : !state.user ? 3 : !client ? 4 : 5;
  useEffect(() => { stepHeading.current?.focus(); }, [step]);
  useEffect(() => { if (state?.user) setPassword(""); }, [state?.user]);
  const discovery = <>
    <DepthCard><section className="settings-section">
      <h2>Устройства в локальной сети</h2>
      <p>ПК по кабелю и телефон по Wi-Fi могут быть в одной сети роутера. На ПК включите «Хост LAN».</p>
      <button disabled={blocked} onClick={() => void connection.discover()}><RefreshCw size={18} />{connection.busy ? "Подождите…" : "Найти Orion в сети"}</button>
      {connection.nodes.length > 0 && <ul className="workspace-list">{connection.nodes.map((node) => <li key={node.nodeId + node.address + node.port}>
        <div><strong>{node.name || "Orion"}</strong><p className="helper">{node.address}:{node.port} · ID: {node.nodeId}</p></div>
        <button disabled={blocked || Boolean(state?.paired && state.node?.nodeId !== node.nodeId)} onClick={() => {
          setAddress(node.address); setPort(String(node.port));
          if (state?.paired) void connection.reconnect(node.address,node.port); else void connection.begin(node.address,node.port);
        }}>{state?.paired && state.node?.nodeId === node.nodeId ? "Проверить доверенный ПК" : "Запросить доступ"}</button>
      </li>)}</ul>}
      {connection.searched && !connection.nodes.length && <p role="status">Orion не найден. Это не доказывает, что компьютер выключен: VPN, гостевая сеть или роутер могут блокировать поиск.</p>}
      <p className="helper">В VPN разрешите локальную сеть. Если поиск блокируется, используйте адрес ниже. Найденное устройство получит доступ только после подтверждения на ПК.</p>
      {state?.paired && <details><summary>Изменился адрес доверенного компьютера</summary>
        <label>Новый адрес<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label>Новый порт<input type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></label>
        <button disabled={blocked || !address.trim() || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535} onClick={() => void connection.reconnect(address,Number(port))}>Проверить сертификат и обновить адрес</button>
        <p className="helper">Сертификат и ID должны совпасть с сохранёнными. Повторное разрешение не требуется; смена сертификата требует нового сопряжения.</p>
      </details>}
    </section></DepthCard>
  </>;
  return <section className="connection">
    <section className="connection-overview" aria-label="Настройка синхронизации">
      <Monitor size={28} aria-hidden="true" />
      <div><p className="eyebrow">{step === 5 ? "Ваш компьютер" : `Подключение · шаг ${Math.min(step,4)} из 4`}</p>
        <h2 ref={stepHeading} tabIndex={-1}>{["", "Найдём компьютер", "Разрешите подключение на ПК", "Войдите в аккаунт ПК", "Выберите пространство", "Обмен настроен"][step]}</h2>
        <p>{step === 5 ? `${state?.node?.name ?? "Orion"} · ${data.remoteSelection?.workspaceName ?? "Пространство ПК"}` : "Выполните текущий шаг. Остальное Orion сохранит для следующего запуска."}</p>
      </div>
    </section>
    {state?.paired && !state.user && <p className="helper">1. Устройство сопряжено. Теперь войдите в аккаунт компьютера.</p>}
    {connection.syncError && <p className="error" role="alert">{connection.syncError}</p>}
    {connection.error && <p className="error" role="alert">{connection.error}</p>}
    {connection.message && <p className="notice" role="status">{connection.message}</p>}
    {state?.paired ? <details className="connection-disclosure"><summary>Поиск и адрес компьютера</summary>{discovery}</details> : connection.pairing?.status !== "pending" ? <>{discovery}</> : null}
    {!state?.paired ? <DepthCard><section className="settings-section">

      {connection.pairing?.status !== "pending" && <details className="connection-disclosure"><summary>Компьютер не найден? Ввести адрес</summary>      <form onSubmit={(e) => { e.preventDefault(); saveProfile(); }}>
        <label>Адрес компьютера<input value={address} placeholder="192.168.1.20" autoCapitalize="none" autoCorrect="off" onChange={(e) => setAddress(e.target.value)} /></label>
        <label>Порт<input type="number" inputMode="numeric" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <button disabled={blocked}>Сохранить профиль</button>
      </form>
      <button className="primary" disabled={blocked || !address.trim() || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535}
        onClick={() => void connection.begin(address, Number(port))}><Link2 size={18} />Запросить подключение</button>
      </details>}
      {connection.pairing?.status === "pending" ? <div className="pair-code">
        <h3>Подтвердите телефон на ПК</h3>
        <p>Введите этот код в заявке на компьютере. Если он не принимается, не подтверждайте другое устройство.</p>
        <strong aria-label={"Код сопряжения " + connection.pairing.code.split("").join(" ")}>{connection.pairing.code}</strong>
        <p>{connection.pairing.node.name} · ожидаем подтверждения</p>
        <button disabled={blocked} onClick={() => void connection.poll()}><RefreshCw size={18} />Проверить подтверждение</button>
      </div> : null}
    </section></DepthCard> : <>
      <DepthCard><section className="settings-section"><h2><ShieldCheck size={20} /> {state.node?.name ?? "Компьютер подключён"}</h2>
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
          {client ? <details className="connection-disclosure"><summary>Изменить пространство</summary>          <h3>Пространства компьютера</h3>
          <p className="helper">Для офлайн-правок включите гибридный режим нужного пространства на ПК.</p>
          {connection.workspaces.length ? <ul className="workspace-list">{connection.workspaces.map((space) => <li key={space.id}>
            <button disabled={blocked} onClick={() => void connection.connect(space)}>
              <span>{space.name}<small>{space.isPersonal ? "Личное" : "Общее"} · {space.role === "owner" ? "Владелец" : space.role === "lead" ? "Руководитель" : "Участник"}</small></span>
              {data.remoteSelection?.workspaceId === space.id && <Check size={18} />}
            </button></li>)}</ul> : <p>Список пока не загружен или доступных пространств нет.</p>}
          <button disabled={blocked} onClick={() => void connection.reloadWorkspaces()}>Обновить список пространств</button></details> : <>          <h3>Пространства компьютера</h3>
          <p className="helper">Для офлайн-правок включите гибридный режим нужного пространства на ПК.</p>
          {connection.workspaces.length ? <ul className="workspace-list">{connection.workspaces.map((space) => <li key={space.id}>
            <button disabled={blocked} onClick={() => void connection.connect(space)}>
              <span>{space.name}<small>{space.isPersonal ? "Личное" : "Общее"} · {space.role === "owner" ? "Владелец" : space.role === "lead" ? "Руководитель" : "Участник"}</small></span>
              {data.remoteSelection?.workspaceId === space.id && <Check size={18} />}
            </button></li>)}</ul> : <p>Список пока не загружен или доступных пространств нет.</p>}
          <button disabled={blocked} onClick={() => void connection.reloadWorkspaces()}>Обновить список пространств</button></>}

        </>}
      </section></DepthCard>
      {client && data.remoteSelection && <DepthCard><section className="settings-section">
        <h2>{data.remoteSelection.workspaceName}</h2>
        <p className="helper">Автоматический обмен: задачи, заметки и списки этого пространства. Финансы остаются на телефоне.</p>
        <div className="space-choice">
          <button aria-pressed={!data.remoteActive} disabled={blocked} onClick={() => void connection.switchSpace(false)}>На телефоне</button>
          <button aria-pressed={data.remoteActive} disabled={blocked} onClick={() => void connection.switchSpace(true)}>Пространство ПК</button>
        </div>
        <p>{status?.phase === "offline" ? "Нет связи с компьютером. Правки сохраняются на телефоне."
          : status?.phase === "syncing" ? "Обмениваемся изменениями…" : status?.asOf ? "Последний ответ ПК: " + new Date(status.asOf).toLocaleString("ru-RU") : "Копия ещё не подтверждена."}</p>
        <p className="helper">Автоматический обмен: при открытии, после правок и каждые 15 секунд, пока приложение активно. В фоне обмен не обещается.</p>
        <p className="helper">В очереди: {status?.pending ?? 0}. Конфликтов: {status?.conflicts ?? 0}.</p>
        <button disabled={blocked || status?.phase === "syncing"} onClick={() => void connection.sync()}><RefreshCw size={18} />Синхронизировать</button>
        <details className="connection-disclosure"><summary>Перенести записи «На телефоне» ({data.tasks.length + data.notes.length})</summary>        <h3>Скопировать записи телефона</h3>
        <p>Задач: {data.tasks.length}. Заметок: {data.notes.length}. Оригиналы останутся в разделе «На телефоне».</p><p className="helper">Списки и финансы этим действием не копируются.</p>
        <label className="ack-row"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>Скопировать в «{data.remoteSelection.workspaceName}». Участники этого пространства смогут видеть копии согласно своим правам.</span></label>
        {!backupCurrent && <button disabled={blocked} onClick={backup}><Download size={18} />Сохранить резервную копию</button>}
        <button disabled={blocked || !backupCurrent || !acknowledged || !(data.tasks.length + data.notes.length)}
          onClick={() => { void connection.importLocal(); setAcknowledged(false); }}><Copy size={18} />Скопировать записи в пространство</button>
</details>
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
      </section></DepthCard>}
      <DepthCard><section className="settings-section">
        <button className="text-button" onClick={() => setDisconnect((value) => !value)}>Отключение и выход</button>
        {disconnect && <div><p>Копии пространств и их неотправленные изменения будут удалены с этого телефона. Сначала экспортируйте нужные записи. Раздел «На телефоне» сохранится.</p>
          {state.user && <button disabled={blocked} onClick={() => void connection.disconnect(false)}>Выйти и удалить копии ПК</button>}
          <button disabled={blocked} onClick={() => void connection.disconnect(true)}>Отключить ПК и удалить его копии</button>
        </div>}
      </section></DepthCard>
    </>}
    <details className="connection-disclosure"><summary>Резервная копия и сведения</summary>    <DepthCard><section className="settings-section">
      <h2>Резервная копия</h2>
      <p>Сохраните задачи, заметки, финансы и черновики в JSON перед первым переносом на компьютер.</p>
      <button onClick={backup} disabled={blocked}><Download size={18} />Сохранить резервную копию</button>
      <p className="helper">{backupCurrent ? "Текущая версия записей телефона экспортирована." : "После изменения записей понадобится новая копия."}</p>
    </section></DepthCard>

    <dl><div><dt>Локальные операции телефона</dt><dd>{data.outbox.length}</dd></div><div><dt>Версия</dt><dd>{ANDROID_VERSION} · {ANDROID_RELEASE_LABEL}</dd></div></dl></details>
  </section>;
}
