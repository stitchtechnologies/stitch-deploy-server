#!/bin/bash

sudo yum install docker -y

# install docker-compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

sudo systemctl start docker


cat << EOF > docker-compose.yml
version: "3.9"
services:

  twenty:
    image: twentycrm/twenty-front:\${TAG}
    ports:
      - 3001:3000
    environment:
      - SIGN_IN_PREFILLED=\${SIGN_IN_PREFILLED}
      - REACT_APP_SERVER_BASE_URL=\${LOCAL_SERVER_URL}
      - REACT_APP_SERVER_AUTH_URL=\${LOCAL_SERVER_URL}/auth
      - REACT_APP_SERVER_FILES_URL \${LOCAL_SERVER_URL}/files
    depends_on:
      - backend

  backend:
    image: twentycrm/twenty-server:\${TAG}
    ports:
      - 3000:3000
    environment:
      - SIGN_IN_PREFILLED=\${SIGN_IN_PREFILLED}
      - PG_DATABASE_URL=\${PG_DATABASE_URL}
      - FRONT_BASE_URL=\${FRONT_BASE_URL}
      - PORT=3000
      - STORAGE_TYPE=local
      - STORAGE_LOCAL_PATH=.local-storage
      - ACCESS_TOKEN_SECRET=\${ACCESS_TOKEN_SECRET}
      - LOGIN_TOKEN_SECRET=\${LOGIN_TOKEN_SECRET}
      - REFRESH_TOKEN_SECRET=\${REFRESH_TOKEN_SECRET}
    depends_on:
      - db

  db:
    image: twentycrm/twenty-postgres:\${TAG}
    volumes:
      - twenty-db-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=\${POSTGRES_ADMIN_PASSWORD}
      - ALLOW_EMPTY_PASSWORD=yes
  
volumes:
  twenty-db-data:
EOF

env_content="PG_DATABASE_URL=postgres://twenty:twenty@postgres:5432/default
FRONT_BASE_URL=http://localhost:3001
ACCESS_TOKEN_SECRET=replace_me_with_a_random_string_access
LOGIN_TOKEN_SECRET=replace_me_with_a_random_string_login
REFRESH_TOKEN_SECRET=replace_me_with_a_random_string_refresh
SIGN_IN_PREFILLED=true
TAG=latest"

# Write the content to the .env file
echo "$env_content" > .env

sudo docker-compose up -d