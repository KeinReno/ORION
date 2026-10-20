-- Pet Care: обычный вес питомца в профиле (как в профиле MurHP). Новых таблиц нет — RLS не меняется.
ALTER TABLE "pet_care_pets" ADD COLUMN "weightKg" DOUBLE PRECISION;
