CREATE TABLE finance_device_versions (
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "entityId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "toAccountId" TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "entityId")
);
CREATE TABLE finance_device_receipts (
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "deviceId" TEXT NOT NULL, "opId" TEXT NOT NULL, "entityId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL, "bodyHash" TEXT NOT NULL, result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "userId", "deviceId", "opId")
);
ALTER TABLE finance_device_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_device_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE finance_device_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_device_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_device_versions_scope ON finance_device_versions USING (
 EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = finance_device_versions."workspaceId" AND m."userId" = current_setting('app.current_user_id', true))
 AND EXISTS (SELECT 1 FROM finance_accounts a WHERE a.id = finance_device_versions."accountId")
 AND ("toAccountId" IS NULL OR EXISTS (SELECT 1 FROM finance_accounts a WHERE a.id = finance_device_versions."toAccountId"))
);
CREATE POLICY finance_device_receipts_scope ON finance_device_receipts USING (
 "userId" = current_setting('app.current_user_id', true)
 AND EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = finance_device_receipts."workspaceId" AND m."userId" = current_setting('app.current_user_id', true))
 AND EXISTS (SELECT 1 FROM finance_accounts a WHERE a.id = finance_device_receipts."accountId")
);

-- No business content, only versions. Definer is needed when account cascade has
-- already hidden the source account under RLS. No callable parameters or dynamic SQL.
CREATE FUNCTION finance_device_bump_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE w TEXT; e TEXT; a TEXT; b TEXT; gone BOOLEAN := false;
BEGIN
 IF TG_TABLE_NAME = 'finance_transaction_lines' THEN
   IF TG_OP = 'UPDATE' AND OLD."transactionId" <> NEW."transactionId" THEN
     INSERT INTO public.finance_device_versions ("workspaceId","entityId","accountId","toAccountId")
       SELECT t."workspaceId",t.id,t."accountId",t."toAccountId" FROM public.finance_transactions t WHERE t.id=OLD."transactionId"
     ON CONFLICT ("workspaceId","entityId") DO UPDATE SET revision=finance_device_versions.revision+1,"updatedAt"=CURRENT_TIMESTAMP;
   END IF;
   IF TG_OP = 'DELETE' THEN e := OLD."transactionId"; ELSE e := NEW."transactionId"; END IF;
   SELECT t."workspaceId", t."accountId", t."toAccountId" INTO w,a,b FROM public.finance_transactions t WHERE t.id = e;
   IF NOT FOUND THEN RETURN NULL; END IF;
 ELSE
   IF TG_OP = 'DELETE' THEN w:=OLD."workspaceId"; e:=OLD.id; a:=OLD."accountId"; b:=OLD."toAccountId"; gone:=true;
   ELSE w:=NEW."workspaceId"; e:=NEW.id; a:=NEW."accountId"; b:=NEW."toAccountId"; END IF;
 END IF;
 -- Workspace deletion cascades all metadata; do not recreate it during cascade.
 IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=w) THEN RETURN NULL; END IF;
 INSERT INTO public.finance_device_versions ("workspaceId","entityId","accountId","toAccountId",revision,deleted)
 VALUES (w,e,a,b,1,gone)
 ON CONFLICT ("workspaceId","entityId") DO UPDATE SET revision=finance_device_versions.revision+1,
 "accountId"=EXCLUDED."accountId", "toAccountId"=EXCLUDED."toAccountId", deleted=EXCLUDED.deleted, "updatedAt"=CURRENT_TIMESTAMP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_device_bump_version() FROM PUBLIC;
INSERT INTO finance_device_versions ("workspaceId","entityId","accountId","toAccountId")
 SELECT "workspaceId",id,"accountId","toAccountId" FROM finance_transactions;
CREATE TRIGGER finance_device_header_version AFTER INSERT OR UPDATE OR DELETE ON finance_transactions
 FOR EACH ROW EXECUTE FUNCTION finance_device_bump_version();
CREATE TRIGGER finance_device_line_version AFTER INSERT OR UPDATE OR DELETE ON finance_transaction_lines
 FOR EACH ROW EXECUTE FUNCTION finance_device_bump_version();
