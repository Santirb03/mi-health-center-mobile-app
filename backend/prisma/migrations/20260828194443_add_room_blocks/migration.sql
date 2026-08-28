-- CreateTable
CREATE TABLE "room_blocks" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_blocks_roomId_idx" ON "room_blocks"("roomId");

-- CreateIndex
CREATE INDEX "room_blocks_startTime_endTime_idx" ON "room_blocks"("startTime", "endTime");

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
