import { ListsScreen, type ListsScreenProps } from "../features/lists/lists-screen";
import type { ComponentProps } from "react";
import { ListChecks, ListTodo, NotebookPen, Wallet } from "lucide-react";
import { TasksScreen, type TasksScreenProps } from "../features/tasks/tasks-screen";
import { NotesScreen, type NotesScreenProps } from "../features/notes/notes-screen";
import { FinancePage } from "../finance";
import { createModuleRegistry } from "./runtime/module-registry";

// Only this composition root knows the bundled implementations.
export function createBuiltinModules(ports: {
  lists: ListsScreenProps; tasks: TasksScreenProps; notes: NotesScreenProps; finance: ComponentProps<typeof FinancePage> & { launchKey?: number };
  createTask: () => void; createNote: () => void;
}) {
  return createModuleRegistry([
    { id: "tasks", label: "Задачи", icon: ListTodo, summary: "Освободите голову. Начните с одного дела.", render: () => <TasksScreen {...ports.tasks} />,
      primary: { label: "Создать", run: ports.createTask, disabled: ports.tasks.busy || !ports.tasks.available } },
    { id: "notes", label: "Заметки", icon: NotebookPen, summary: "Мысли и детали, к которым хочется вернуться.", render: () => <NotesScreen {...ports.notes} />,
      primary: { label: "Создать", run: ports.createNote, disabled: ports.notes.busy || !ports.notes.available } },
    { id: "finance", label: "Финансы", icon: Wallet, summary: "Запишите расход, пока не забыли.", render: () => <FinancePage key={ports.finance.launchKey ?? "default"} {...ports.finance} /> },
    { id: "lists", label: "Списки", icon: ListChecks, summary: "Покупки, дела и сборы — пункт за пунктом.", render: () => <ListsScreen {...ports.lists} /> },
  ]);
}
