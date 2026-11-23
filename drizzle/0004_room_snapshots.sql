CREATE TABLE "room_snapshots" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
