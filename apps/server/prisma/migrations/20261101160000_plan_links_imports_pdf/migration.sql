-- Ein Plan kann nur einem Eintrag pro Tool zugeordnet sein.
-- Bestehende Doppelzuordnungen lösen (der neueste Eintrag behält den Plan).
UPDATE `Livestream` l JOIN `Livestream` n ON n.tenantId = l.tenantId AND n.planId = l.planId AND n.createdAt > l.createdAt SET l.planId = NULL;
UPDATE `Podcast` p JOIN `Podcast` n ON n.tenantId = p.tenantId AND n.planId = p.planId AND n.createdAt > p.createdAt SET p.planId = NULL;
UPDATE `VisitorCount` v JOIN `VisitorCount` n ON n.tenantId = v.tenantId AND n.planId = v.planId AND n.createdAt > v.createdAt SET v.planId = NULL;

-- AlterTable
ALTER TABLE `Podcast` ADD COLUMN `externalGuid` VARCHAR(500) NULL,
    ADD COLUMN `imported` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `linkUrl` TEXT NULL,
    ADD COLUMN `pdfFileName` VARCHAR(191) NULL,
    ADD COLUMN `pdfStatus` VARCHAR(191) NULL,
    ADD COLUMN `pdfUrl` TEXT NULL,
    ADD COLUMN `planTitle` VARCHAR(191) NULL,
    ADD COLUMN `scripture` VARCHAR(191) NULL,
    MODIFY `sourceProvider` VARCHAR(191) NULL,
    MODIFY `sourceVideoId` VARCHAR(191) NULL,
    MODIFY `startSec` INTEGER NULL,
    MODIFY `endSec` INTEGER NULL;

-- AlterTable
ALTER TABLE `VisitorCount` ADD COLUMN `imported` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (vor dem Entfernen des alten Index, damit der Fremdschlüssel weiterhin einen Index hat)
CREATE UNIQUE INDEX `Livestream_tenantId_planId_key` ON `Livestream`(`tenantId`, `planId`);
DROP INDEX `Livestream_tenantId_planId_idx` ON `Livestream`;

-- CreateIndex
CREATE INDEX `Podcast_tenantId_publishedAt_idx` ON `Podcast`(`tenantId`, `publishedAt`);
CREATE UNIQUE INDEX `Podcast_tenantId_planId_key` ON `Podcast`(`tenantId`, `planId`);
CREATE UNIQUE INDEX `Podcast_tenantId_externalGuid_key` ON `Podcast`(`tenantId`, `externalGuid`);
CREATE UNIQUE INDEX `VisitorCount_tenantId_planId_key` ON `VisitorCount`(`tenantId`, `planId`);
