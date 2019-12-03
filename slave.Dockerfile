FROM node:10
LABEL maintainer "abondoa@gmail.com"
RUN apt-get update && \
    apt-get install git curl tar jq -y && \
    mkdir /factorioClusterio && \
    cd /factorioClusterio && \
    curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && \
    tar -xf factorio.tar.gz && \
    mkdir instances sharedMods
WORKDIR /factorioClusterio
ENV MOD_VERSION=1.15.2
COPY . /factorioClusterio
RUN cp config.json.dist config.json && \
    npm install --only=production && \
    node client.js download

VOLUME ["/factorioClusterio/instances", "/factorioClusterio/sharedMods", "/factorioClusterio/sharedPlugins"]

ENTRYPOINT [ "/factorioClusterio/entrypoint.slave.sh" ]

CMD [ "node", "client.js", "start" ]
