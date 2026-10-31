CREATE TABLE `payout_inputs` (
	`outpoint` varchar(80) NOT NULL,
	`block_hash` varchar(64) NOT NULL,
	CONSTRAINT `payout_inputs_outpoint` PRIMARY KEY(`outpoint`)
);
--> statement-breakpoint
CREATE TABLE `payouts` (
	`block_hash` varchar(64) NOT NULL,
	`visitor` varchar(128) NOT NULL,
	`status` enum('pending','sent') NOT NULL,
	`reward_sats` varchar(32) NOT NULL,
	`amount_sats` varchar(32) NOT NULL,
	`txid` varchar(64) NOT NULL,
	`inputs` text NOT NULL,
	`time` varchar(32) NOT NULL,
	`sent_time` varchar(32),
	CONSTRAINT `payouts_block_hash` PRIMARY KEY(`block_hash`)
);
--> statement-breakpoint
CREATE TABLE `share_results` (
	`share` varchar(128) NOT NULL,
	`time` varchar(32) NOT NULL,
	`accepted` boolean NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` varchar(128) NOT NULL,
	`visitor` varchar(128) NOT NULL,
	`block_hash` varchar(64) NOT NULL,
	`is_block` boolean NOT NULL,
	`time` varchar(32) NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT `shares_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `payout_inputs_block` ON `payout_inputs` (`block_hash`);--> statement-breakpoint
CREATE INDEX `share_results_time` ON `share_results` (`time`);--> statement-breakpoint
CREATE INDEX `shares_blocks` ON `shares` (`is_block`,`visitor`);--> statement-breakpoint
CREATE INDEX `shares_block_hash` ON `shares` (`block_hash`);--> statement-breakpoint
CREATE INDEX `shares_time` ON `shares` (`time`);