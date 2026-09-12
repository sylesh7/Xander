-- AlterTable
ALTER TABLE "ActionReceipt" ADD COLUMN     "enforcementAdapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enforcementReason" TEXT,
ADD COLUMN     "executedAt" TIMESTAMP(3);
