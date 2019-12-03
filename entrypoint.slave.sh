#!/bin/Bash
if [[ -f '/factorioClusterio/secret-api-token.txt']]; then
    secret=$(cat '/factorioClusterio/secret-api-token.txt')
    ./jq '. | setpath(["masterAuthToken"];"'$secret'")' config.json | config.json.tmp
    rm config.json
    mv config.json.tmp config.json
fi

/bin/bash -c "$@"