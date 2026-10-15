import { execFile, spawn } from "node:child_process";

const API_RULE = "ORION LAN API";
const MDNS_RULE = "ORION LAN mDNS";

export type FirewallState = "unsupported" | "missing" | "present";

function ruleExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("netsh", ["advfirewall", "firewall", "show", "rule", `name=${name}`], { windowsHide: true }, (error, stdout) => {
      resolve(!error && stdout.includes(name));
    });
  });
}

/** Читать правила может любой пользователь; менять — только администратор, поэтому запись идёт через UAC (ниже). */
export async function firewallState(): Promise<FirewallState> {
  if (process.platform !== "win32") return "unsupported";
  return (await ruleExists(API_RULE)) && (await ruleExists(MDNS_RULE)) ? "present" : "missing";
}

/** Правила только для частной сети и только из локальной подсети: Wi-Fi кафе (Public) порт не откроет. */
export function firewallAddCommands(port: number): string[] {
  return [
    `netsh advfirewall firewall add rule name="${API_RULE}" dir=in action=allow protocol=TCP localport=${port} profile=private remoteip=localsubnet`,
    `netsh advfirewall firewall add rule name="${MDNS_RULE}" dir=in action=allow protocol=UDP localport=5353 profile=private remoteip=localsubnet`
  ];
}

export function firewallRemoveCommands(): string[] {
  return [`netsh advfirewall firewall delete rule name="${API_RULE}"`, `netsh advfirewall firewall delete rule name="${MDNS_RULE}"`];
}

/**
 * Запуск команд с повышением прав. Системный диалог UAC показывает сама Windows — молча порты не открываются;
 * отказ пользователя или нехватка прав возвращаются как false, и режим хоста остаётся включённым, но «только на этой машине».
 */
function runElevated(commands: string[]): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const joined = commands.join(" & ");
  const script = `try { $p = Start-Process -FilePath cmd.exe -ArgumentList '/c ${joined.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export const openFirewall = (port: number) => runElevated(firewallAddCommands(port));
export const closeFirewall = () => runElevated(firewallRemoveCommands());
