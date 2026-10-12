CREATE TABLE "player_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_snapshots" (
	"at" timestamp with time zone PRIMARY KEY NOT NULL,
	"connected_players" integer NOT NULL,
	"open_rooms" integer NOT NULL,
	"games_in_progress" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "player_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "banned_reason" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "player_logins" ADD CONSTRAINT "player_logins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_logins_player_idx" ON "player_logins" USING btree ("player_id","at");--> statement-breakpoint
CREATE INDEX "player_logins_at_idx" ON "player_logins" USING btree ("at");--> statement-breakpoint
CREATE INDEX "admin_actions_player_idx" ON "admin_actions" USING btree ("player_id");