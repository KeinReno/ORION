import { ConflictException } from "@nestjs/common";
import type { AssistantStatus, Opportunity } from "@orion/shared-types";
import type { ProfileEvidence } from "../opportunities-profiles/public";
import { PROVIDER_ID, RULES_VERSION, runRules, type EngineOutput } from "./assessment-engine";

/**
 * Контракт OpportunityAssessmentProvider (ADR-0008). Провайдер получает только данные для оценки и возвращает типизированный
 * результат; у него нет ни права отправки, ни доступа к диску/сети ORION. Внешняя модель НЕ подключена: пока владелец не
 * определил провайдера, бюджет и передачу персональных данных, доступен только локальный провайдер правил.
 */
export interface AssessmentProvider {
  readonly id: string; readonly version: string; readonly label: string; readonly sendsDataExternally: boolean;
  assess(opportunity: Opportunity, evidence: ProfileEvidence): EngineOutput;
}

const rules: AssessmentProvider = {
  id: PROVIDER_ID, version: RULES_VERSION, label: "Локальные правила (без внешних сервисов)", sendsDataExternally: false,
  assess: (opportunity, evidence) => runRules(opportunity, evidence)
};

const PROVIDERS = new Map<string, AssessmentProvider>([[rules.id, rules]]);

export function getProvider(id: string): AssessmentProvider {
  const provider = PROVIDERS.get(id);
  if (provider) return provider;
  if (id === "llm") throw new ConflictException("ИИ-провайдер не подключён. Для подключения владельцу нужно определить провайдера, бюджет и какие данные профиля можно передавать.");
  throw new ConflictException(`Неизвестный провайдер «${id}»`);
}

export function assistantStatus(): AssistantStatus {
  return {
    externalSend: false,
    providers: [
      { id: rules.id, label: rules.label, available: true, sendsDataExternally: false, reason: "Сопоставление по общим словам, только по подтверждённым фактам. Смысл текста не анализируется." },
      { id: "llm", label: "Языковая модель", available: false, sendsDataExternally: true, reason: "ИИ не подключён. Нужно решение владельца: провайдер, бюджет и разрешённые к передаче данные профиля. Резюме автоматически никуда не передаются." }
    ]
  };
}
