# Use an official Python runtime as a parent image
FROM python:3.11-slim

ENV UV_LINK_MODE=copy \
    PATH="/root/.local/bin:${PATH}"

# Set the working directory in the container
WORKDIR /app

# Install system dependencies and uv
RUN apt-get update \
    && apt-get install -y curl build-essential libsqlite3-dev \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# Copy project metadata and resolve dependencies with uv
COPY pyproject.toml /app/
RUN uv sync --no-dev

# Ensure the virtualenv binaries are on PATH
ENV PATH="/app/.venv/bin:${PATH}"

# Copy the backend code into the container at /app
COPY ./backend /app/backend

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Run app.py when the container launches
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
