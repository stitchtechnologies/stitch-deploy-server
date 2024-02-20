#!/bin/bash

sudo yum install docker -y

# install docker-compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

sudo systemctl start docker

sudo docker run --pull=always --rm -p 5432:5432 -e "POSTGRES_USER=$USER" -e "POSTGRES_PASSWORD=postgres" -v ./lantern_data:/var/lib/postgresql/data lanterndata/lantern:latest-pg15