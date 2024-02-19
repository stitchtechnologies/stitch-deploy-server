#!/bin/bash

sudo yum install docker -y

# install docker-compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

sudo systemctl start docker

sudo yum install git -y

# Clone repository
git clone https://github.com/langfuse/langfuse.git
cd langfuse

# Run server and database
sudo docker-compose up -d