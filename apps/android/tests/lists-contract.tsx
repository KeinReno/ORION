// Browser-only fixture, not a production Vite input.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { List } from "@orion/shared-types";
import type { MobileListMutation } from "@orion/mobile-core";
import { ListsScreen } from "../src/features/lists/lists-screen";
const initial: List = { id: "qa-list", workspaceId: "qa-workspace", name: "QA archive contract", kind: "general", isTemplate: false, archivedAt: null, sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [] };
const mutations: MobileListMutation[] = [];
declare global { interface Window { listContract: { mutations: MobileListMutation[]; unarchive: () => void; local: () => void } } }
function Fixture() {
  const [lists, setLists] = useState([initial]);
  const [selectedId, select] = useState<string | undefined>(initial.id);
  const [remote, setRemote] = useState(true);
  window.listContract = { mutations, unarchive: () => setLists(xs => xs.map(x => ({ ...x, archivedAt: null }))), local: () => setRemote(false) };
  return <ListsScreen lists={lists} selectedId={selectedId} select={select} initialDraft={null} busy={false} available canItems remote={remote} saveDraft={async () => {}} mutate={async mutation => {
    mutations.push(mutation);
    if (mutation.kind === "delete") setLists([]);
    else setLists(xs => xs.map(x => ({ ...x, ...mutation.fields })));
    return true;
  }} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
