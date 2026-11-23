#!/bin/sh
# Sauvegarde quotidienne de la base GameOfLife (cron sur la VM) : 14 jours gardés.
set -eu
DIR="$HOME/backups/gameoflife"
mkdir -p "$DIR"
docker exec gameoflife-gol-db-1 pg_dump -U gameoflife -d gameoflife --no-owner | gzip -9 > "$DIR/gameoflife-$(date +%Y%m%d-%H%M).sql.gz"
find "$DIR" -name 'gameoflife-*.sql.gz' -mtime +14 -delete
