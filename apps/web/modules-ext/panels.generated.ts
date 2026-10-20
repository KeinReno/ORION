// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import { MessagesSquare, PawPrint } from "lucide-react";
import dynamic from "next/dynamic";
import { createElement, type ComponentType, type FunctionComponent } from "react";
import type { PanelComponentProps, PanelDefinition } from "../lib/panel-registry";

const LazyGeneratedChatArchivePanel = dynamic(() => import("./chat-archive/ChatArchivePanel").then((module) => module.ChatArchivePanel), { ssr: false });
const GeneratedChatArchivePanel: FunctionComponent<PanelComponentProps> = (props) => createElement(LazyGeneratedChatArchivePanel as ComponentType<PanelComponentProps>, props);
const LazyGeneratedPetCarePanel = dynamic(() => import("./pet-care/PetCarePanel").then((module) => module.PetCarePanel), { ssr: false });
const GeneratedPetCarePanel: FunctionComponent<PanelComponentProps> = (props) => createElement(LazyGeneratedPetCarePanel as ComponentType<PanelComponentProps>, props);

/** Панели подключаемых модулей; panel-registry.ts добавляет их к встроенным, поверхности (G17) выводит из манифеста сам. */
export const generatedPanelDefinitions: Omit<PanelDefinition, "surfaces">[] = [
  { id: "chat-archive", label: "Архив чатов", icon: MessagesSquare, component: GeneratedChatArchivePanel, moduleId: "chat-archive", group: "Инструменты" },
  { id: "pet-care", label: "Питомцы", icon: PawPrint, component: GeneratedPetCarePanel, moduleId: "pet-care", group: "Семья и дом" }
];
