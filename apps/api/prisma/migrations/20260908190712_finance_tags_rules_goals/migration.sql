-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'backlog';
ALTER TYPE "TaskStatus" ADD VALUE 'canceled';

-- AlterTable
ALTER TABLE "finance_transactions" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "finance_category_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "matchText" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_savings_goals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "targetDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_category_rules_workspaceId_idx" ON "finance_category_rules"("workspaceId");

-- CreateIndex
CREATE INDEX "finance_savings_goals_workspaceId_idx" ON "finance_savings_goals"("workspaceId");

-- AddForeignKey
ALTER TABLE "finance_category_rules" ADD CONSTRAINT "finance_category_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_category_rules" ADD CONSTRAINT "finance_category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_savings_goals" ADD CONSTRAINT "finance_savings_goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_savings_goals" ADD CONSTRAINT "finance_savings_goals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
