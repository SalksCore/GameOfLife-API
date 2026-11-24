ALTER TABLE "players" ADD COLUMN "pair_code" text;--> statement-breakpoint
-- Les comptes existants reçoivent aussi un code binôme (6 caractères sans ambiguïté)
UPDATE "players" SET "pair_code" = (
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 6 + 0 * length("players"."id"::text))
);--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_pair_code_unique" UNIQUE("pair_code");
