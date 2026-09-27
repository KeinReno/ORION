/*
  Warnings:

  - You are about to drop the column `amount` on the `finance_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `categoryId` on the `finance_transactions` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'transfer';

-- DropForeignKey
ALTER TABLE "finance_transactions" DROP CONSTRAINT "finance_transactions_categoryId_fkey";

-- AlterTable
ALTER TABLE "finance_transactions" DROP COLUMN "amount",
DROP COLUMN "categoryId",
ADD COLUMN     "toAccountId" TEXT;

-- CreateTable
CREATE TABLE "finance_transaction_lines" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "categoryId" TEXT,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "finance_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_transaction_lines_workspaceId_idx" ON "finance_transaction_lines"("workspaceId");

-- CreateIndex
CREATE INDEX "finance_transaction_lines_transactionId_idx" ON "finance_transaction_lines"("transactionId");

-- CreateIndex
CREATE INDEX "finance_transaction_lines_categoryId_idx" ON "finance_transaction_lines"("categoryId");

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transaction_lines" ADD CONSTRAINT "finance_transaction_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "finance_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transaction_lines" ADD CONSTRAINT "finance_transaction_lines_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
