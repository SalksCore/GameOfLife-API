ALTER TABLE "admins" ADD COLUMN "role" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
-- Les comptes créés avant les rôles (par script, sur le serveur) deviennent propriétaires
UPDATE "admins" SET "role" = 'owner';
