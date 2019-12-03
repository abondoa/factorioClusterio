#!/bin/bash
if [[ -f $SECRET_API_TOKEN_FILE ]]; then
    secret=$(cat $SECRET_API_TOKEN_FILE)
    ./jq '. | setpath(["masterAuthToken"];"'$secret'")' config.json > config.json.tmp
    rm config.json
    mv config.json.tmp config.json
fi

exec "$@"
