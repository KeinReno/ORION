// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { AgentToolDef } from "../agent-tools";

/** Инструменты ИИ-агентов, объявленные модулями в манифесте (`agent.tools`); `AGENT_TOOLS` добавляет их к инструментам ядра. */
export const GENERATED_AGENT_TOOLS: readonly AgentToolDef[] = [
  {
    "name": "orion_agent_hub_queue",
    "description": "Показывает ожидающие задания и собственные текущие исполнения. Требуется tasks:read; действует ограничение на проекты токена. Не запускает IDE и не обещает автономности.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/agent-hub/executions"
    },
    "input": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "permission": "agent-hub.execution.read",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_claim",
    "description": "Взять выбранное ожидающее задание в ручной MCP-сессии. Сервер привязывает исполнение к токену агента, выдаёт lease на 120 секунд. Не запускает модель автоматически. После claim вызовите report action=start.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/executions/{executionId}/claim"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string",
          "description": "UUID исполнения, возвращённый orion_agent_hub_queue"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия состояния из последнего ответа Agent Hub (защита от гонки)"
        }
      },
      "required": [
        "executionId",
        "expectedRevision"
      ],
      "additionalProperties": false
    },
    "example": {
      "executionId": "<uuid>",
      "expectedRevision": 0
    },
    "permission": "agent-hub.execution.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_report",
    "description": "Отправить реальное событие о выполнении своего задания (start, heartbeat, checkpoint, submit, block, fail). Только владелец действующего lease. Данные не подтверждают автоматически завершение: submit ставит на проверку. Heartbeat продлевает lease на 120 секунд.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/executions/{executionId}/report"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string",
          "description": "UUID исполнения, возвращённый orion_agent_hub_queue"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия состояния из последнего ответа Agent Hub (защита от гонки)"
        },
        "action": {
          "type": "string",
          "enum": [
            "start",
            "heartbeat",
            "checkpoint",
            "submit",
            "block",
            "fail"
          ],
          "description": "Тип отчёта"
        },
        "checkpointRef": {
          "type": "string",
          "description": "Контрольная точка (checkpoint): ссылка на сохранённое состояние, без секретов"
        },
        "evidenceRefs": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Для submit: 1–20 ссылок на конкретные проверяемые артефакты"
        },
        "reason": {
          "type": "string",
          "description": "Для block или fail: причина"
        }
      },
      "required": [
        "executionId",
        "expectedRevision",
        "action"
      ],
      "additionalProperties": false
    },
    "example": {
      "executionId": "<uuid>",
      "expectedRevision": 2,
      "action": "checkpoint",
      "checkpointRef": "git:abcdef"
    },
    "permission": "agent-hub.execution.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_runtime_register",
    "description": "Зарегистрировать заявленную сессию наблюдателя Habitat. Это НЕ подтверждение работающей модели и НЕ право запускать программы. Требуются действующий токен и tasks:read.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/runtime-sessions"
    },
    "input": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "description": "UUID локальной сессии Habitat, сгенерированный при запуске"
        },
        "kind": {
          "type": "string",
          "enum": [
            "habitat_observer"
          ]
        },
        "capabilities": {
          "type": "object",
          "description": "Только observe-only: canStart=false, canCancel=false, canObserve=true, canResume=false"
        }
      },
      "required": [
        "sessionId",
        "kind",
        "capabilities"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.runtime.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_runtime_pulse",
    "description": "Продлить TTL собственной зарегистрированной сессии наблюдения (5 минут), с проверкой ревизии. Не означает, что CLI работает.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/runtime-sessions/{sessionId}/pulse"
    },
    "input": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "description": "UUID локальной сессии Habitat, сгенерированный при запуске"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия серверной сессии для CAS"
        }
      },
      "required": [
        "sessionId",
        "expectedRevision"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.runtime.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_runtime_close",
    "description": "Явно закрыть собственную сессию Habitat; нельзя закрывать чужие сессии.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/runtime-sessions/{sessionId}/close"
    },
    "input": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "description": "UUID локальной сессии Habitat, сгенерированный при запуске"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия серверной сессии для CAS"
        }
      },
      "required": [
        "sessionId",
        "expectedRevision"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.runtime.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_delegate",
    "description": "Передать подпоручение другому профилю агента из текущего исполнения. Требуются действующий lease и привязка токена к профилю. Глубина ограничена политикой пространства, цикл A→B→A отклоняется. Дочернее исполнение получает структурированный payload (задача, проект, материалы, ограничения прав).",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/executions/{executionId}/delegate"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string",
          "description": "UUID текущего (родительского) исполнения"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия состояния из последнего ответа Agent Hub"
        },
        "targetAgentId": {
          "type": "string",
          "description": "UUID профиля агента-исполнителя"
        },
        "summary": {
          "type": "string",
          "description": "Краткая формулировка подпоручения"
        },
        "instructions": {
          "type": "string",
          "description": "Подробное задание, только факты и ограничения"
        },
        "taskId": {
          "type": "string",
          "description": "Задача, к которой относится подпоручение (по умолчанию — задача родителя)"
        },
        "projectId": {
          "type": "string",
          "description": "Проект подпоручения для проверки границ токена"
        },
        "materialLinkIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Ссылки EntityLink на связанные материалы без копирования содержимого"
        },
        "constraints": {
          "type": "object",
          "description": "Ограничения прав: readOnly, allowedModules, maxDepth (может только ужесточить политику)"
        }
      },
      "required": [
        "executionId",
        "expectedRevision",
        "targetAgentId",
        "summary"
      ],
      "additionalProperties": false
    },
    "example": {
      "executionId": "<uuid>",
      "expectedRevision": 2,
      "targetAgentId": "<profile-uuid>",
      "summary": "Проверить тесты и вернуть отчёт",
      "constraints": {
        "readOnly": true
      }
    },
    "permission": "agent-hub.execution.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_request_approval",
    "description": "Остановить своё исполнение до подтверждения владельцем перед операцией с правами выше read-only. Статус станет waiting_approval; продолжение — только после approve владельца. Scope-ceiling не расширяется.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/executions/{executionId}/request-approval"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string",
          "description": "UUID собственного исполнения"
        },
        "expectedRevision": {
          "type": "integer",
          "description": "Ревизия состояния из последнего ответа Agent Hub"
        },
        "action": {
          "type": "string",
          "description": "Какая операция требует подтверждения"
        },
        "reason": {
          "type": "string",
          "description": "Почему операция не может быть выполнена read-only"
        }
      },
      "required": [
        "executionId",
        "expectedRevision",
        "action",
        "reason"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.execution.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_trace_record",
    "description": "Записать фактический шаг исполнения: tool_call, tool_result, note или error. Только текущий исполнитель. Результат инструмента ссылается на шаг tool_call через parentStepId; длительность вычисляется сервером. Внутренние рассуждения модели не фиксируются.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/executions/{executionId}/trace"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string",
          "description": "UUID собственного исполнения"
        },
        "stepId": {
          "type": "string",
          "description": "Логический id шага, уникальный внутри исполнения"
        },
        "parentStepId": {
          "type": "string",
          "description": "Шаг-родитель в дереве (для tool_result — его tool_call)"
        },
        "type": {
          "type": "string",
          "enum": [
            "tool_call",
            "tool_result",
            "note",
            "error"
          ],
          "description": "Тип шага"
        },
        "name": {
          "type": "string",
          "description": "Имя инструмента или короткая метка шага"
        },
        "payload": {
          "type": "object",
          "description": "Фактические аргументы/результат без секретов"
        },
        "error": {
          "type": "string",
          "description": "Текст ошибки для type=error"
        },
        "attempt": {
          "type": "integer",
          "description": "Номер повторной попытки, начиная с 0"
        }
      },
      "required": [
        "executionId",
        "stepId",
        "type"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.execution.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_memory_write",
    "description": "Записать версионированное знание агента. Области: global, project, agent, user. Перезапись того же ключа создаёт новую ревизию и помечает прежнюю superseded; история сохраняется. В чужую user-память и в память другого профиля запись запрещена (403).",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/agent-hub/memory"
    },
    "input": {
      "type": "object",
      "properties": {
        "scope": {
          "type": "string",
          "enum": [
            "global",
            "project",
            "agent",
            "user"
          ],
          "description": "Область памяти"
        },
        "scopeId": {
          "type": "string",
          "description": "projectId для project; для agent/user подставляется caller"
        },
        "key": {
          "type": "string",
          "description": "Ключ знания внутри области"
        },
        "value": {
          "description": "JSON-значение"
        },
        "provenanceEventId": {
          "type": "string",
          "description": "Событие/исполнение, из которого получено знание"
        }
      },
      "required": [
        "scope",
        "key",
        "value"
      ],
      "additionalProperties": false
    },
    "permission": "agent-hub.memory.create",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_memory_read",
    "description": "Прочитать доступную агенту память по области и ключу. user-память видна только этому же агенту того же пользователя; память другого профиля недоступна (403).",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/agent-hub/memory"
    },
    "input": {
      "type": "object",
      "properties": {
        "scope": {
          "type": "string",
          "enum": [
            "global",
            "project",
            "agent",
            "user"
          ]
        },
        "scopeId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "includeHistory": {
          "type": "boolean",
          "description": "Включить superseded/outdated ревизии"
        },
        "limit": {
          "type": "integer"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "permission": "agent-hub.memory.read",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_agent_hub_context",
    "description": "Собрать контекст перед запуском: доступную память по областям исполнения и публичные возможности включённых модулей, которые разрешены этому токену. Устаревшие записи помечены needsVerification.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/agent-hub/context"
    },
    "input": {
      "type": "object",
      "properties": {
        "executionId": {
          "type": "string"
        },
        "taskId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "agentId": {
          "type": "string"
        },
        "includeCapabilities": {
          "type": "boolean"
        },
        "limit": {
          "type": "integer"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "permission": "agent-hub.memory.read",
    "moduleId": "agent-hub"
  },
  {
    "name": "orion_chat_archive_search",
    "description": "Поиск по прошлым разговорам владельца с ИИ-агентами (Claude Code, Codex): реплики человека и ответы, содержащие фразу. Возвращает conversationId, заголовок, проект, seq строки и отрывок. Найденное — история обсуждений, а не принятые решения.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/chat-archive/search"
    },
    "input": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Что искать (от 2 символов)"
        },
        "source": {
          "type": "string",
          "enum": [
            "claude-code",
            "codex"
          ],
          "description": "Только из этого источника"
        },
        "limit": {
          "type": "integer",
          "description": "Сколько совпадений (до 100, по умолчанию 30)"
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false
    },
    "example": {
      "q": "архив чатов"
    },
    "permission": "chat-archive.conversation.read",
    "moduleId": "chat-archive"
  },
  {
    "name": "orion_chat_archive_list",
    "description": "Последние 50 разговоров архива: id, источник, заголовок, папка проекта, даты, число сообщений.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/chat-archive/conversations"
    },
    "input": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "enum": [
            "claude-code",
            "codex"
          ],
          "description": "Только из этого источника"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "permission": "chat-archive.conversation.read",
    "moduleId": "chat-archive"
  },
  {
    "name": "orion_chat_archive_read",
    "description": "Прочитать разговор по страницам: по умолчанию только реплики человека и ответы (messagesOnly=true), 100 строк. Следующая страница — after = nextSeq из ответа. Длинный текст строки обрезан до 20 000 символов.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/chat-archive/conversations/{conversationId}/lines"
    },
    "input": {
      "type": "object",
      "properties": {
        "conversationId": {
          "type": "string",
          "description": "id разговора из orion_chat_archive_search или orion_chat_archive_list"
        },
        "after": {
          "type": "integer",
          "description": "Начать после этой строки (nextSeq прошлой страницы); по умолчанию с начала"
        },
        "limit": {
          "type": "integer",
          "description": "Строк на странице (до 300, по умолчанию 100)"
        },
        "messagesOnly": {
          "type": "string",
          "enum": [
            "true",
            "false"
          ],
          "description": "false — со служебными строками, вызовами инструментов и их результатами"
        }
      },
      "required": [
        "conversationId"
      ],
      "additionalProperties": false
    },
    "permission": "chat-archive.conversation.read",
    "moduleId": "chat-archive"
  },
  {
    "name": "orion_chat_archive_import",
    "description": "Сохранить в архив строки файла транскрипта (jsonl Claude Code или Codex) без изменений. Обычно это делает хук автоматически; инструмент — для разового сохранения небольшого файла. Продолжение: fromSeq = lineCount из ответа; повтор той же пачки ничего не дублирует, разрыв — 409 с lineCount.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/chat-archive/import"
    },
    "input": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "enum": [
            "claude-code",
            "codex"
          ],
          "description": "Чей это транскрипт"
        },
        "externalId": {
          "type": "string",
          "description": "id сессии в источнике (sessionId Claude Code, id из session_meta Codex)"
        },
        "fromSeq": {
          "type": "integer",
          "description": "Номер первой присылаемой строки файла, с 0"
        },
        "projectPath": {
          "type": "string",
          "description": "Папка проекта, если её нет в строках"
        },
        "lines": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Строки файла как есть, без перевода строки (до 2000)"
        }
      },
      "required": [
        "source",
        "externalId",
        "fromSeq",
        "lines"
      ],
      "additionalProperties": false
    },
    "permission": "chat-archive.conversation.create",
    "moduleId": "chat-archive"
  },
  {
    "name": "orion_pet_care_list_pets",
    "description": "Список питомцев пространства (id, имя, вид, день рождения, заметки). id нужен для orion_pet_care_add_entry.",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/pet-care/pets"
    },
    "input": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.read",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_add_entry",
    "description": "Записать в журнал ухода факт: кормление, ветеринар, лекарство или прогулка. Это факт, а не напоминание.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/pet-care/pets/{petId}/entries"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца из orion_pet_care_list_pets"
        },
        "kind": {
          "type": "string",
          "enum": [
            "feeding",
            "vet",
            "medication",
            "walk"
          ],
          "description": "feeding — кормление, vet — ветеринар, medication — лекарство, walk — прогулка"
        },
        "occurredAt": {
          "type": "string",
          "description": "Когда было (ISO-дата со временем); без значения — сейчас"
        },
        "note": {
          "type": "string",
          "description": "Комментарий (до 2000 символов)"
        }
      },
      "required": [
        "petId",
        "kind"
      ],
      "additionalProperties": false
    },
    "example": {
      "petId": "<id питомца>",
      "kind": "feeding",
      "note": "Сухой корм, 60 г"
    },
    "permission": "pet-care.pet.create",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_diary",
    "description": "Дневник самочувствия питомца за период (по умолчанию 30 дней): состояние дня, аппетит, активность, стул, вода, рвота, вес, температура, лекарства, симптомы, заметка — и тревожные сигналы по этим отметкам (не диагноз).",
    "group": "modules",
    "effect": "read",
    "scopes": null,
    "http": {
      "method": "GET",
      "path": "/ai/v1/pet-care/pets/{petId}/days"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца из orion_pet_care_list_pets"
        },
        "from": {
          "type": "string",
          "description": "С дня YYYY-MM-DD"
        },
        "to": {
          "type": "string",
          "description": "По день YYYY-MM-DD"
        },
        "today": {
          "type": "string",
          "description": "Сегодня по времени пользователя, YYYY-MM-DD"
        }
      },
      "required": [
        "petId"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.read",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_record_day",
    "description": "Отметить самочувствие питомца за день: переданные поля дописываются к уже записанному за этот день (симптом с тем же id заменяется). appetite: normal|reduced|picky|refused; activity: normal|low|very_low|restless; stool: none|normal|soft|liquid|constipation|blood|mucus; water: normal|reduced|none; symptoms: [{id, severity: mild|moderate|severe|critical, count, time: morning|day|evening|night, note}] — id из каталога (vomiting, diarrhea, lethargy, no_appetite…).",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/pet-care/pets/{petId}/days/{day}"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "day": {
          "type": "string",
          "description": "День YYYY-MM-DD"
        },
        "appetite": {
          "type": "string",
          "description": "Аппетит"
        },
        "activity": {
          "type": "string",
          "description": "Активность"
        },
        "stool": {
          "type": "string",
          "description": "Стул"
        },
        "water": {
          "type": "string",
          "description": "Вода"
        },
        "vomitingCount": {
          "type": "integer",
          "description": "Сколько раз рвало"
        },
        "weightKg": {
          "type": "number",
          "description": "Вес, кг"
        },
        "temperature": {
          "type": "number",
          "description": "Температура, °C"
        },
        "meds": {
          "type": "string",
          "description": "Лекарства и процедуры — как записал хозяин"
        },
        "note": {
          "type": "string",
          "description": "Заметка (дописывается)"
        },
        "symptoms": {
          "type": "array",
          "items": {
            "type": "object"
          },
          "description": "Симптомы"
        }
      },
      "required": [
        "petId",
        "day"
      ],
      "additionalProperties": false
    },
    "example": {
      "petId": "<id питомца>",
      "day": "2026-10-20",
      "vomitingCount": 2,
      "appetite": "reduced"
    },
    "permission": "pet-care.pet.create",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_add_event",
    "description": "Записать событие, которое может объяснять самочувствие: смена корма, новый продукт, лекарство, прививка, обработка от паразитов, визит к ветеринару, стресс, заметка.",
    "group": "modules",
    "effect": "create",
    "scopes": null,
    "http": {
      "method": "POST",
      "path": "/ai/v1/pet-care/pets/{petId}/events"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "day": {
          "type": "string",
          "description": "День YYYY-MM-DD"
        },
        "type": {
          "type": "string",
          "enum": [
            "food_change",
            "new_food",
            "medication",
            "vaccination",
            "antiparasitic",
            "vet_visit",
            "stress",
            "note"
          ],
          "description": "Вид события"
        },
        "title": {
          "type": "string",
          "description": "Кратко"
        },
        "note": {
          "type": "string",
          "description": "Подробности"
        }
      },
      "required": [
        "petId",
        "day"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.create",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_delete_day",
    "description": "Удалить запись дневника самочувствия за день. В режимах помощник и менеджер это только запрос человеку (ответ 202), «администратор» выполняет действие сразу.",
    "group": "modules",
    "effect": "delete",
    "scopes": null,
    "http": {
      "method": "DELETE",
      "path": "/ai/v1/pet-care/pets/{petId}/days/{day}"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "day": {
          "type": "string",
          "description": "День YYYY-MM-DD"
        },
        "reason": {
          "type": "string",
          "description": "Почему"
        }
      },
      "required": [
        "petId",
        "day"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.delete",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_delete_event",
    "description": "Удалить событие дневника питомца (смена корма, прививка и т. п.). В режимах помощник и менеджер это только запрос человеку (ответ 202), «администратор» выполняет действие сразу.",
    "group": "modules",
    "effect": "delete",
    "scopes": null,
    "http": {
      "method": "DELETE",
      "path": "/ai/v1/pet-care/pets/{petId}/events/{eventId}"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "eventId": {
          "type": "string",
          "description": "id события"
        },
        "reason": {
          "type": "string",
          "description": "Почему"
        }
      },
      "required": [
        "petId",
        "eventId"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.delete",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_delete_entry",
    "description": "Удалить запись ухода (кормление, прогулка, груминг…). В режимах помощник и менеджер это только запрос человеку (ответ 202), «администратор» выполняет действие сразу.",
    "group": "modules",
    "effect": "delete",
    "scopes": null,
    "http": {
      "method": "DELETE",
      "path": "/ai/v1/pet-care/pets/{petId}/entries/{entryId}"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "entryId": {
          "type": "string",
          "description": "id записи"
        },
        "reason": {
          "type": "string",
          "description": "Почему"
        }
      },
      "required": [
        "petId",
        "entryId"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.delete",
    "moduleId": "pet-care"
  },
  {
    "name": "orion_pet_care_delete_pet",
    "description": "Удалить питомца вместе со всем дневником и уходом. В режимах помощник и менеджер это только запрос человеку (ответ 202), «администратор» выполняет действие сразу; спрашивайте, только если человек сам этого хочет.",
    "group": "modules",
    "effect": "delete",
    "scopes": null,
    "http": {
      "method": "DELETE",
      "path": "/ai/v1/pet-care/pets/{petId}"
    },
    "input": {
      "type": "object",
      "properties": {
        "petId": {
          "type": "string",
          "description": "id питомца"
        },
        "reason": {
          "type": "string",
          "description": "Почему"
        }
      },
      "required": [
        "petId"
      ],
      "additionalProperties": false
    },
    "permission": "pet-care.pet.delete",
    "moduleId": "pet-care"
  }
];
