FROM node:10
LABEL maintainer "Sir3lit@gmail.com"
COPY . /factorioClusterio
WORKDIR factorioClusterio
RUN apt-get update && apt install git curl tar -y && \
    npm install --only=production && \
    curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && \
    tar -xf factorio.tar.gz && \
    curl -o jq -L https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 && \
    mkdir instances sharedMods && \
    cp config.json.dist config.json && \
    node client.js download

VOLUME /factorioClusterio/instances
VOLUME /factorioClusterio/sharedMods
VOLUME /factorioClusterio/sharedPlugins
VOLUME /factorioClusterio/secret-api-token.txt

ENTRYPOINT [ "/factorioClusterio/entrypoint.slave.sh" ]

CMD RCONPORT="$RCONPORT" FACTORIOPORT="$FACTORIOPORT" node client\.js start $INSTANCE
