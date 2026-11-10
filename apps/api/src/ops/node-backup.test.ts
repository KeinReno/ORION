import { describe, expect, it } from "vitest";
import { assertBackupRowsMatchColumns } from "./node-backup";

describe("backup row shape validation", () => {
  const columns = ["id", "payload"];

  it("accepts rows with exactly the table columns", () => {
    expect(() => assertBackupRowsMatchColumns(['{"id":"row-1","payload":{"title":"ok"}}'], "example", columns)).not.toThrow();
  });

  it("rejects missing and unknown columns before PostgreSQL can coerce them", () => {
    expect(() => assertBackupRowsMatchColumns(['{"id":"row-1"}'], "example", columns)).toThrow("Столбцы строки резервной копии example не совпадают со схемой.");
    expect(() => assertBackupRowsMatchColumns(['{"id":"row-1","payload":null,"unknown":true}'], "example", columns)).toThrow("Столбцы строки резервной копии example не совпадают со схемой.");
  });

  it("rejects duplicate keys at every JSON nesting level", () => {
    expect(() => assertBackupRowsMatchColumns(['{"id":"first","id":"last","payload":{}}'], "example", columns)).toThrow("Таблица example содержит неподдерживаемую строку резервной копии.");
    expect(() => assertBackupRowsMatchColumns(['{"id":"row-1","payload":{"key":1,"key":2}}'], "example", columns)).toThrow("Таблица example содержит неподдерживаемую строку резервной копии.");
  });
});
