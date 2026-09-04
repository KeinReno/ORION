"use client";

import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "@orion/core-react";
import { Button, Card, Input, Textarea } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { useActiveWorkspace } from "../../../lib/use-active-workspace";

export default function NotesPage(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: notes, isLoading } = useNotes(workspace?.id);
  const createNote = useCreateNote(workspace?.id);
  const updateNote = useUpdateNote(workspace?.id);
  const deleteNote = useDeleteNote(workspace?.id);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    await createNote.mutateAsync({ title, body });
    setTitle("");
    setBody("");
  }

  function startEdit(id: string, currentTitle: string, currentBody: string): void {
    setEditingId(id);
    setEditTitle(currentTitle);
    setEditBody(currentBody);
  }

  async function onSaveEdit(id: string): Promise<void> {
    await updateNote.mutateAsync({ noteId: id, input: { title: editTitle, body: editBody } });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Заметки</h1>

      <Card className="max-w-xl">
        <form className="flex flex-col gap-3" onSubmit={onCreate}>
          <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea placeholder="Текст (необязательно)" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" disabled={createNote.isPending}>
            {createNote.isPending ? "Добавляем…" : "Добавить заметку"}
          </Button>
        </form>
      </Card>

      {isLoading ? <p className="text-sm text-white/50">Загрузка…</p> : null}
      {!isLoading && notes?.length === 0 ? <p className="text-sm text-white/50">Заметок пока нет.</p> : null}

      <div className="flex flex-col gap-3">
        {notes?.map((note) => (
          <Card key={note.id} className="max-w-xl">
            {editingId === note.id ? (
              <div className="flex flex-col gap-2">
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                <Textarea rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => onSaveEdit(note.id)} disabled={updateNote.isPending}>
                    Сохранить
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)}>
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{note.title}</h2>
                  {note.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-white/60">{note.body}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => startEdit(note.id, note.title, note.body)}>
                    Изменить
                  </Button>
                  <Button variant="danger" onClick={() => deleteNote.mutate(note.id)} disabled={deleteNote.isPending}>
                    Удалить
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
