# SPDX-License-Identifier: AGPL-3.0-only
FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
WORKDIR /srv/ai
COPY services/ai/app ./app
COPY services/ai/config ./config
COPY services/ai/provider ./provider
USER 65532:65532
EXPOSE 8080
CMD ["python", "-m", "app.server"]
