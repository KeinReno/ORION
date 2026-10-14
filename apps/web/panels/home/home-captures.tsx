"use client";

import { Lightbulb } from "lucide-react";
import { CapturesSection } from "../../components/captures-section";
import { SectionCard, type HomeSectionProps } from "./shared";

/** Ideas, problems and notes about this home — «поменять замок», «течёт кран». The first non-project host of Capture. */
export function HomeCaptures({ workspaceId, home }: HomeSectionProps): React.ReactElement {
  return (
    <SectionCard title="Идеи и заметки" icon={Lightbulb}>
      <CapturesSection workspaceId={workspaceId} anchorType="home" anchorId={home.id} />
    </SectionCard>
  );
}
