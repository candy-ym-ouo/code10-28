-- DropIndex
DROP INDEX "media_assets_object_key_key";

-- CreateIndex
CREATE INDEX "media_assets_object_key_idx" ON "media_assets"("object_key");

