"""Chatbot functionality for the LIV CRM."""

from fastapi import APIRouter, Body, HTTPException
import httpx
from pydantic import BaseModel, Field

router = APIRouter(prefix="/chat", tags=["chatbot"])

OLLAMA_API_URL = "https://ollama.drascom.uk/api/chat"


class ChatRequest(BaseModel):
    message: str = Field(..., description="User message to send to the chatbot")


@router.get("/", response_model=dict)
async def chat_status() -> dict:
    """Lightweight readiness check to avoid 405s on GET /chat/."""
    return {"status": "ready"}


@router.post("/", response_model=dict)
async def chat_with_bot(payload: ChatRequest):
    """Handles chatbot requests and communicates with the Ollama API."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                OLLAMA_API_URL,
                json={
                    "model": "llama2",
                    "messages": [{"role": "user", "content": payload.message}],
                    "stream": False,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            ollama_response = response.json()
            assistant_message = ollama_response.get("message", {}) or {}
            content = assistant_message.get("content", "")
            return {"message": {"role": assistant_message.get("role", "assistant"), "content": content}}
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=f"Error connecting to Ollama: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code, detail=f"Ollama API error: {exc.response.text}"
        ) from exc
