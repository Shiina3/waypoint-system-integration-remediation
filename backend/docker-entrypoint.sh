#!/bin/sh
set -eu

port="${PORT:-10000}"
sed -ri "s/^Listen 80$/Listen ${port}/" /etc/apache2/ports.conf
sed -ri "s/:80>/:${port}>/" /etc/apache2/sites-available/000-default.conf

php artisan config:cache
php artisan migrate --force
exec apache2-foreground
