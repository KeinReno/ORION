import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { APP_UPDATE_DEFAULT_REPO, type FeedbackResult, type SendFeedbackInput } from "@orion/shared-types";

/** Отдельный токен от «Обновлений» (§ update.service.ts): тому read-only прав на релизы достаточно,
 * этому нужно право Issues: Write на репозиторий — разные ключи, разная зона ответственности. */
function githubApi(): string {
  return (process.env.ORION_GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function feedbackRepo(): string {
  return process.env.ORION_GITHUB_FEEDBACK_REPO?.trim() || APP_UPDATE_DEFAULT_REPO;
}

/** Обратная связь из приложения → issue в GitHub. Ничего не хранится в ORION — только проксирует наружу. */
@Injectable()
export class FeedbackService {
  async send(input: SendFeedbackInput, reporter: { email: string }): Promise<FeedbackResult> {
    const token = process.env.ORION_GITHUB_FEEDBACK_TOKEN?.trim();
    if (!token) throw new ServiceUnavailableException("Отправка обратной связи не настроена на сервере (нет ORION_GITHUB_FEEDBACK_TOKEN)");
    const firstLine = input.message.split("\n", 1)[0]!.trim();
    const title = `[${input.kind === "bug" ? "Баг" : "Предложение"}] ${firstLine.slice(0, 72)}`;
    const body = [input.message, "", "---", `От: ${reporter.email}`, `Версия: ${process.env.APP_VERSION ?? "неизвестна"}`].join("\n");
    let response: Response;
    try {
      response = await fetch(`${githubApi()}/repos/${feedbackRepo()}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "orion-feedback"
        },
        body: JSON.stringify({ title, body, labels: [input.kind === "bug" ? "bug" : "enhancement", "from-app"] }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new BadRequestException("Не удалось связаться с GitHub — проверьте подключение к интернету");
    }
    if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException("GitHub отклонил токен обратной связи");
    if (!response.ok) throw new BadRequestException(`GitHub ответил ошибкой (код ${response.status})`);
    const issue = (await response.json()) as { html_url: string };
    return { issueUrl: issue.html_url };
  }
}
