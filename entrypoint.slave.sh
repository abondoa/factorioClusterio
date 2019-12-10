#!/bin/bash

wait_file() {
  local file="$1"; shift
  local wait_seconds="${1:-10}"; shift # 10 seconds as default timeout

  until test $((wait_seconds--)) -eq 0 -o -f "$file" ; do sleep 1; done

  ((++wait_seconds))
}

if [[ -n "$SECRET_API_TOKEN_FILE" ]]; then
    echo "Wait 10 sec for secret file to become available"
    wait_file "$SECRET_API_TOKEN_FILE" || {
        echo "The file $SECRET_API_TOKEN_FILE did not become available in time"
        exit 1
    }
    masterAuthToken=$(cat $SECRET_API_TOKEN_FILE)
fi
jq '. | 
setpath(["masterAuthToken"];"'$masterAuthToken'") |
setpath(["masterIP"];"'$MASTERIP'") |
setpath(["username"];"'$USERNAME'") |
setpath(["token"];"'$TOKEN'")' \
config.json > config.json.tmp
rm config.json
mv config.json.tmp config.json

exec "$@"
