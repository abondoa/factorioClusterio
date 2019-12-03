FROM node:10
LABEL maintainer "abondoa@gmail.com"
RUN apt-get update && \
    apt install git curl tar -y && \
    mkdir /factorioClusterio && \
    cd /factorioClusterio && \
    curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && \
    tar -xf factorio.tar.gz && \
    curl -o jq -L https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 && \
    chmod +x jq && \
    mkdir instances sharedMods
COPY . /factorioClusterio
WORKDIR /factorioClusterio
ENV MOD_VESION=1.15.2
RUN cp config.json.dist config.json && \
    npm install --only=production && \
    node client.js download

VOLUME /factorioClusterio/instances
VOLUME /factorioClusterio/sharedMods
VOLUME /factorioClusterio/sharedPlugins

ENTRYPOINT [ "/factorioClusterio/entrypoint.slave.sh" ]

CMD ["node", "client.js", "start"
