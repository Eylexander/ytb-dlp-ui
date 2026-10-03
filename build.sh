#!/bin/bash
set -e

# Default variables
DEV=false
FRONTEND=false
BACKEND=false
PUSH=false
OPTIONS=""
TAG_PREFIX="eylexander/ytdlp-ui"

# Parse arguments
for arg in "$@"; do
    case "$arg" in
    -dev) DEV=true ;;
    -frontend) FRONTEND=true ;;
    -backend) BACKEND=true ;;
    -nc) OPTIONS="$OPTIONS --no-cache" ;;
    -push) PUSH=true ;;
    -h | --help)
        echo "Usage: ./build.sh [options]"
        echo "Options:"
        echo "  -dev      : Build development images"
        echo "  -frontend : Build only the frontend image"
        echo "  -backend  : Build only the backend image"
        echo "  -nc       : Build images without cache"
        echo "  -push     : Push images to Docker Hub after building"
        exit 0
        ;;
    *)
        echo "Error: Unknown option '$arg'"
        exit 1
        ;;
    esac
done

# If neither is specified, build both
if [ "$FRONTEND" = false ] && [ "$BACKEND" = false ]; then
    FRONTEND=true
    BACKEND=true
fi

echo "--- Starting Build ---"
echo "Development mode : $DEV"
echo "Build Frontend   : $FRONTEND"
echo "Build Backend    : $BACKEND"
echo "Push images      : $PUSH"
echo "----------------------"

if [ "$DEV" = true ]; then
    if [ "$BACKEND" = true ]; then
        echo "Building Backend (DEV)..."
        DOCKER_BUILDKIT=1 docker build $OPTIONS -f ./docker/backend.dev.Dockerfile --tag ytdlp-ui-backend-dev ./backend
    fi
    if [ "$FRONTEND" = true ]; then
        echo "Building Frontend (DEV)..."
        DOCKER_BUILDKIT=1 docker build $OPTIONS -f ./docker/frontend.dev.Dockerfile --tag ytdlp-ui-frontend-dev ./frontend
    fi
else
    if [ "$BACKEND" = true ]; then
        echo "Building Backend (PROD)..."
        DOCKER_BUILDKIT=1 docker build $OPTIONS -f ./docker/backend.Dockerfile --tag ${TAG_PREFIX}-backend:latest ./backend
    fi
    if [ "$FRONTEND" = true ]; then
        echo "Building Frontend (PROD)..."
        DOCKER_BUILDKIT=1 docker build $OPTIONS -f ./docker/frontend.Dockerfile --tag ${TAG_PREFIX}-frontend:latest ./frontend
    fi
fi

if [ "$PUSH" = true ]; then
    if [ "$DEV" = true ]; then
        echo "Warning: Push is skipped in development mode."
    else
        echo "Pushing images..."
        if [ "$BACKEND" = true ]; then
            docker push "${TAG_PREFIX}-backend:latest"
        fi
        if [ "$FRONTEND" = true ]; then
            docker push "${TAG_PREFIX}-frontend:latest"
        fi
    fi
fi

echo "Done!"
