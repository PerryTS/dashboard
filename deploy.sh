#!/bin/bash
set -e

echo "Building static site..."
npm run build:site

echo "Uploading to server..."
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  ./ root@webserver.skelpo.net:/opt/perry-dashboard/

echo "Compiling server on remote..."
ssh root@webserver.skelpo.net "cd /opt/perry-dashboard && perry compile server.ts -o server && systemctl restart perry-dashboard"

echo "Done. Checking health..."
sleep 2
curl -s https://app.perryts.com/ > /dev/null && echo "Dashboard is live" || echo "Warning: health check failed"
