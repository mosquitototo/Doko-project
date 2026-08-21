FROM python:3.14-slim@sha256:ce40764625a4ff50df3548277632e7f96c4e77fe75fa848aae9885476e7df5a4

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_ONLY_BINARY=:all:

WORKDIR /app

RUN pip install --no-cache-dir pip==26.2.1

COPY ./requirements-lock.txt /tmp/requirements-lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements-lock.txt

COPY ./app /app/app

RUN addgroup --system doko && adduser --system --ingroup doko doko

USER doko

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
