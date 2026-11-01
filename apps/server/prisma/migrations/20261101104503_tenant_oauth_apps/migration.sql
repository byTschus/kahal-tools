-- CreateTable
CREATE TABLE `OAuthApp` (
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(512) NOT NULL,
    `clientSecret` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OAuthApp` ADD CONSTRAINT `OAuthApp_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
