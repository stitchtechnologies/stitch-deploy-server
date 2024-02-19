#!/bin/bash

sudo yum install docker -y

# install docker-compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

sudo systemctl start docker

sudo docker run -d --name clickhouse-server --env ALLOW_EMPTY_PASSWORD=yes -p 80:8123 bitnami/clickhouse:latest