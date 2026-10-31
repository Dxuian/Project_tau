CREATE TABLE `payout_inputs` (
	`outpoint` text PRIMARY KEY NOT NULL,
	`block_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payout_inputs_block` ON `payout_inputs` (`block_hash`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`block_hash` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`status` text NOT NULL,
	`reward_sats` text NOT NULL,
	`amount_sats` text NOT NULL,
	`txid` text NOT NULL,
	`inputs` text NOT NULL,
	`time` text NOT NULL,
	`sent_time` text,
	CONSTRAINT "payouts_status" CHECK("payouts"."status" IN ('pending', 'sent'))
);
--> statement-breakpoint
CREATE TABLE `share_results` (
	`share` text NOT NULL,
	`time` text NOT NULL,
	`accepted` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `share_results_time` ON `share_results` (`time`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`block_hash` text NOT NULL,
	`is_block` integer NOT NULL,
	`time` text NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shares_blocks` ON `shares` (`is_block`,`visitor`);--> statement-breakpoint
CREATE INDEX `shares_block_hash` ON `shares` (`block_hash`);--> statement-breakpoint
CREATE INDEX `shares_time` ON `shares` (`time`);