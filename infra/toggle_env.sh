#!/bin/bash

ENV_FILE="$(dirname "$0")/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE does not exist."
    exit 1
fi

ATTRS=$(lsattr "$ENV_FILE" | awk '{print $1}')

if [[ "$ATTRS" == *i* ]]; then
    echo "Unlocking $ENV_FILE (removing immutable flag and adding write permissions)..."
    sudo chattr -i "$ENV_FILE"
    sudo chmod a+w "$ENV_FILE"
else
    echo "Locking $ENV_FILE (removing write permissions and setting immutable flag)..."
    sudo chmod a-w "$ENV_FILE"
    sudo chattr +i "$ENV_FILE"
fi

lsattr "$ENV_FILE"
ls -l "$ENV_FILE"
