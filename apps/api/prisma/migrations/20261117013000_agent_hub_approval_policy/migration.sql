-- P3-1: политика подтверждений Agent Hub. Аддитивная колонка с дефолтом:
-- существующие пространства получают "non_admin" без изменения поведения данных.
ALTER TABLE "agent_hub_policies" ADD COLUMN "approvals" TEXT NOT NULL DEFAULT 'non_admin';
