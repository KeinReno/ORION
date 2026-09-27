-- AlterTable
ALTER TABLE "finance_transactions" ADD COLUMN     "recurringRuleId" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_recurringRuleId_scheduledFor_key" ON "finance_transactions"("recurringRuleId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "finance_recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

