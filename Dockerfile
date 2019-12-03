FROM node:10
RUN apt-get update && apt install git curl tar -y
RUN mkdir factorioClusterio
COPY . /factorioClusterio

#COPY bin /factorioClusterio/bin
#COPY CHANGELOG.md /factorioClusterio/CHANGELOG.md
#COPY client.js /factorioClusterio/client.js
#COPY ["CLI tools", "/factorioClusterio/CLI tools"]
#COPY config.json.dist /factorioClusterio/config.json.dist
#COPY docker-compose.yml /factorioClusterio/docker-compose.yml
#COPY Dockerfile /factorioClusterio/Dockerfile
#COPY lib /factorioClusterio/lib
#COPY LICENSE.md /factorioClusterio/LICENSE.md
#COPY logo.svg /factorioClusterio/logo.svg
#COPY master.js /factorioClusterio/master.js
#COPY master.spec.js /factorioClusterio/master.spec.js
#COPY package.json /factorioClusterio/package.json
#COPY README.md /factorioClusterio/README.md
#COPY routes /factorioClusterio/routes
#COPY routes.js /factorioClusterio/routes.js
#COPY sharedPlugins /factorioClusterio/sharedPlugins
RUN ls factorioClusterio
RUN cd factorioClusterio && npm install --only=production
RUN cd factorioClusterio && curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && tar -xf factorio.tar.gz

WORKDIR factorioClusterio
RUN mkdir instances sharedMods
RUN cp config.json.dist config.json

RUN node client.js download

LABEL maintainer "Sir3lit@gmail.com"

EXPOSE 8080 34167
VOLUME /factorioClusterio/instances
VOLUME /factorioClusterio/sharedMods
VOLUME /factorioClusterio/sharedPlugins

CMD RCONPORT="$RCONPORT" FACTORIOPORT="$FACTORIOPORT" MODE="$MODE" node $MODE\.js start $INSTANCE
