/**
 * Токен чтения релизов приватного репозитория. В репозиторий не кладётся:
 * его задаёт ORION_GITHUB_UPDATE_TOKEN на этом компьютере. Пустая строка
 * значит, что встроенного токена нет и используется только токен из настроек.
 */
export function builtinGithubUpdateToken(): string {
  return (process.env.ORION_GITHUB_UPDATE_TOKEN ?? "").trim();
}
