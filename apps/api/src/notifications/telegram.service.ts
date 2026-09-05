import { Injectable, Logger } from "@nestjs/common";

/**
 * Sends messages via the Telegram Bot API when TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID are set in the environment. Falls back to a console
 * dry-run otherwise, so the rest of the notifications pipeline (the cron
 * job, the "already notified" bookkeeping) can be built and tested before
 * a real bot exists — wiring up a real token later needs no code change.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  private get token(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN || undefined;
  }

  private get chatId(): string | undefined {
    return process.env.TELEGRAM_CHAT_ID || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  /** Returns whether the message was actually delivered — callers must not record a reminder as sent if this is false. */
  async sendMessage(text: string): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.log(`(dry-run) ${text}`);
      return true;
    }

    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text })
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`Telegram sendMessage failed (${response.status}): ${body}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Telegram sendMessage threw: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
