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
  }
];
