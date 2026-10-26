import type { ReactElement } from "react";
import { PhoneApp } from "../../phone/phone-app";

/** Телефонный клиент: одна страница, без дока. Статический экспорт её перечисляет. */
export default function PhonePage(): ReactElement {
  return <PhoneApp />;
}
