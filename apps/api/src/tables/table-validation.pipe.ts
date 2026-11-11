import { PipeTransform, UnprocessableEntityException } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Валидация входов Orion Tables. В отличие от общего `ZodValidationPipe`
 * (400 на любую ошибку формы) схема таблицы — это содержимое, которое сервер в
 * принципе не может исполнить: неизвестная функция формулы, тип колонки без
 * вариантов выбора, значение не по типу. Задание требует на такую запись 422,
 * поэтому 422 отдаётся здесь, а не 400.
 */
export class TablesValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new UnprocessableEntityException(result.error.flatten());
    return result.data;
  }
}
