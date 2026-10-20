// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { AgentToolDef } from "../agent-tools";

/** Инструменты ИИ-агентов, объявленные модулями в манифесте (`agent.tools`); `AGENT_TOOLS` добавляет их к инструментам ядра. */
export const GENERATED_AGENT_TOOLS: readonly AgentToolDef[] = [
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
  }
];
