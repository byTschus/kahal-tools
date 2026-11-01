-- PDF-Unterstützung entfernt
DELETE FROM `Job` WHERE `type` = 'podcast.pdf';

-- AlterTable
ALTER TABLE `Podcast` DROP COLUMN `pdfFileName`,
    DROP COLUMN `pdfStatus`,
    DROP COLUMN `pdfUrl`;
