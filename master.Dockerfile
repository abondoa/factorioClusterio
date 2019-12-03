FROM node:10
LABEL maintainer "abondoa@gmail.com"
COPY . /factorioClusterio
WORKDIR factorioClusterio

RUN apt-get update && \
    apt install git curl tar -y && \
    npm install --only=production && \
    cp config.json.dist config.json

VOLUME /factorioClusterio/secret-api-token.txt

EXPOSE 8080

CMD node master.js
