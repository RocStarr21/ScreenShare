CREATE TABLE `video_share_options` (
	`videoId` varchar(15) NOT NULL,
	`ctaText` varchar(80),
	`ctaUrl` varchar(2048),
	`emailGate` boolean NOT NULL DEFAULT false,
	`allowDownload` boolean NOT NULL DEFAULT false,
	`thumbnailKey` varchar(512),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_share_options_videoId` PRIMARY KEY(`videoId`)
);
--> statement-breakpoint
CREATE TABLE `video_views` (
	`id` varchar(15) NOT NULL,
	`videoId` varchar(15) NOT NULL,
	`sessionId` varchar(128) NOT NULL,
	`viewerKey` varchar(64),
	`viewerUserId` varchar(15),
	`viewerName` varchar(255),
	`viewerEmail` varchar(255),
	`country` varchar(64),
	`city` varchar(128),
	`browser` varchar(64),
	`os` varchar(64),
	`device` varchar(32),
	`referrer` varchar(512),
	`watchedSeconds` float NOT NULL DEFAULT 0,
	`maxPosition` float NOT NULL DEFAULT 0,
	`videoDuration` float,
	`watchedBuckets` varchar(100) NOT NULL DEFAULT '',
	`ctaClicks` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_views_id` PRIMARY KEY(`id`),
	CONSTRAINT `video_session_idx` UNIQUE(`videoId`,`sessionId`)
);
--> statement-breakpoint
ALTER TABLE `video_share_options` ADD CONSTRAINT `video_share_options_videoId_videos_id_fk` FOREIGN KEY (`videoId`) REFERENCES `videos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_views` ADD CONSTRAINT `video_views_videoId_videos_id_fk` FOREIGN KEY (`videoId`) REFERENCES `videos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `video_created_idx` ON `video_views` (`videoId`,`createdAt`);