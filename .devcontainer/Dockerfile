FROM mcr.microsoft.com/devcontainers/javascript-node:4-24-trixie

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        python-is-python3 \
        build-essential \
        pkg-config \
        libpq-dev \
        postgresql-client \
        redis-tools \
        sqlite3 \
        jq \
        unzip \
        zip \
        ripgrep \
        fd-find \
        dnsutils \
        netcat-openbsd \
        procps \
        lsof \
        tmux \
        tree \
        less \
        vim \
        wget \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @devcontainers/cli
