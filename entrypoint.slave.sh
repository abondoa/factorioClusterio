#!/bin/bash
if [[ -f $SECRET_API_TOKEN_FILE ]]; then
    secret=$(cat $SECRET_API_TOKEN_FILE)
    jq '. | \
    setpath(["masterAuthToken"];"'$secret'") \
    setpath(["masterIP"];"'$MASTERIP'")\
    setpath(["username"];"'$USERNAME'")\
    setpath(["token"];"'$TOKEN'")\
    ' config.json > config.json.tmp
    rm config.json
    mv config.json.tmp config.json
fi

exec "$@"
