FROM node:10
LABEL maintainer "abondoa@gmail.com"
RUN apt-get update && \
    apt install git curl tar -y

COPY . /factorioClusterio
WORKDIR factorioClusterio

RUN npm install --only=production && \
    node lib/npmPostinstall.js && \
    cp config.json.dist config.json

EXPOSE 8080

CMD node master.js
