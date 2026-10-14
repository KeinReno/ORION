-- Module «Контакты»: contacts become universal. The same table «Дом» uses —
-- a home's contact is simply a contact with that homeId — so nothing is copied.
-- homeId becomes optional and deleting a home now keeps its contacts (SET NULL,
-- like tasks/lists/things/payments) instead of cascading. RLS is unchanged: the
-- contacts table already has ENABLE/FORCE RLS and its workspace policy.
ALTER TABLE "contacts" ALTER COLUMN "homeId" DROP NOT NULL;
ALTER TABLE "contacts" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

ALTER TABLE "contacts" DROP CONSTRAINT "contacts_homeId_fkey";
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
