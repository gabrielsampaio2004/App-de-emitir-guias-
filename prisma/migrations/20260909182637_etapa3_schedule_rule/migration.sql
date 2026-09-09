-- CreateEnum
CREATE TYPE "ScheduleRuleType" AS ENUM ('FIXED_DAY', 'BUSINESS_DAYS_BEFORE_DUE');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "scheduleRuleBusinessDaysBefore" INTEGER,
ADD COLUMN     "scheduleRuleFixedDay" INTEGER,
ADD COLUMN     "scheduleRuleType" "ScheduleRuleType" NOT NULL DEFAULT 'FIXED_DAY';
