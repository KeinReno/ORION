import { BadGatewayException, HttpException, HttpStatus } from "@nestjs/common";

/**
 * Минимальный клиент Messages API (ADR-0017, вариант C). Адрес берётся только из окружения (`ORION_ANTHROPIC_URL`, по
 * умолчанию api.anthropic.com), а не из запроса пользователя, поэтому через него нельзя сходить на произвольный хост.
 * Ключ уходит только в заголовок `x-api-key` и нигде не логируется.
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export function anthropicBaseUrl(): string {
  return (process.env.ORION_ANTHROPIC_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
}

export async function callAnthropic(
  apiKey: string,
  body: { model: string; system: string; tools: AnthropicTool[]; messages: AnthropicMessage[]; max_tokens: number }
): Promise<AnthropicResponse> {
  let response: Response;
  try {
    response = await fetch(`${anthropicBaseUrl()}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000)
    });
  } catch {
    throw new BadGatewayException("Не удалось связаться с сервисом языковой модели");
  }
  if (!response.ok) {
    // Тело ответа провайдера может повторять фрагменты запроса — наружу отдаём только понятную причину.
    if (response.status === 401 || response.status === 403) throw new HttpException("Сервис модели отклонил ключ — проверьте его в настройках ассистента", HttpStatus.BAD_GATEWAY);
    if (response.status === 429) throw new HttpException("Сервис модели ограничил частоту запросов — повторите позже", HttpStatus.TOO_MANY_REQUESTS);
    throw new BadGatewayException(`Сервис модели ответил ошибкой (код ${response.status})`);
  }
  return (await response.json()) as AnthropicResponse;
}
