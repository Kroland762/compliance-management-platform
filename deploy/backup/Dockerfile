FROM postgres:15-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/scripts/backup.sh /usr/local/bin/backup.sh
COPY backend/scripts/restore.sh /usr/local/bin/restore.sh
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh

ENTRYPOINT []
CMD ["backup.sh"]
