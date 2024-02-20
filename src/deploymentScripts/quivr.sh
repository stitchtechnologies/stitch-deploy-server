#!/bin/bash

sudo yum install docker -y

# install docker-compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo systemctl start docker


DOWNLOAD_URL=https://github.com/supabase/cli/releases/download/v1.145.1/supabase_1.145.1_linux_amd64.rpm
curl -L -o supabase-cli.rpm "$DOWNLOAD_URL"

sudo rpm -i supabase-cli.rpm

sudo yum install git -y

git clone https://github.com/quivrhq/quivr.git && cd quivr

cp .env.example .env

sudo supabase start

sudo -s 

docker-compose pull
docker-compose up -d
