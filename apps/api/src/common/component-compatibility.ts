import { ConflictException } from "@nestjs/common";
import { componentCompatibilityProblems } from "@orion/shared-types";

export function assertComponentCompatible(id: string, enabledModules: ReadonlySet<string>): void {
  const problems = componentCompatibilityProblems(id, enabledModules);
  if (problems.length) throw new ConflictException({
    code: "component_incompatible",
    componentId: id,
    message: `Компонент «${id}» несовместим с текущей конфигурацией: ${problems.join("; ")}`,
    problems
  });
}
