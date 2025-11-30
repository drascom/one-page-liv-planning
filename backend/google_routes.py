from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from .auth import require_admin_user
from .google_auth import get_google_credentials, save_token_json
from .settings import get_settings
from google_auth_oauthlib.flow import Flow
import json
import logging
import base64

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/google", tags=["google_auth"])
settings = get_settings()

# Allows listing existing folders/files and uploading into them.
SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
]


def _preferred_origin(request: Request) -> str:
    """Respect proxy headers so redirect URIs stay HTTPS on production."""
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_port = request.headers.get("x-forwarded-port")

    if forwarded_host:
        host = forwarded_host.split(",")[0].strip()
        scheme = (forwarded_proto or request.url.scheme).split(",")[0].strip()
        port = ""
        if forwarded_port and ":" not in host and forwarded_port not in ("80", "443"):
            port = f":{forwarded_port.split(',')[0].strip()}"
        return f"{scheme}://{host}{port}"

    scheme = (forwarded_proto or request.url.scheme).split(",")[0].strip()
    return f"{scheme}://{request.url.netloc}"


def _infer_backend_url(request: Request, domain_override: str | None = None) -> str:
    if domain_override:
        return domain_override
    if settings.backend_url:
        return settings.backend_url
    return _preferred_origin(request)


def _encode_state(state_payload: dict) -> str:
    raw = json.dumps(state_payload)
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_state(state_value: str) -> dict:
    if not state_value:
        return {}
    try:
        padding = "=" * (-len(state_value) % 4)
        data = base64.urlsafe_b64decode((state_value + padding).encode())
        parsed = json.loads(data.decode())
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _get_flow(redirect_uri: str):
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=500, detail="Google client id/secret are not configured")
    client_config = {
        "web": {
            "client_id": settings.google_client_id,
            "project_id": settings.google_project_id,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": settings.google_client_secret,
            "redirect_uris": [redirect_uri]
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )

@router.get("/status")
def google_auth_status(current_user: dict = Depends(require_admin_user)):
    creds = get_google_credentials()
    return {"connected": creds is not None and creds.valid}

@router.get("/login-url")
def google_login_url(request: Request, domain: str = None, current_user: dict = Depends(require_admin_user)):
    backend_url = _infer_backend_url(request, domain_override=domain)
    redirect_uri = f"{backend_url.rstrip('/')}/auth/google/callback"
    state = _encode_state({"redirect_uri": redirect_uri})

    try:
        flow = _get_flow(redirect_uri)
        auth_url, _ = flow.authorization_url(
            prompt='consent',
            access_type="offline",
            # Google expects a lowercase string, not Python bool
            include_granted_scopes="true",
            state=state,
        )
        return {"url": auth_url}
    except Exception as e:
        logger.error(f"Failed to create flow: {e}")
        raise HTTPException(status_code=500, detail="Configuration error")

@router.get("/callback")
def google_auth_callback(request: Request, code: str):
    state_data = _decode_state(request.query_params.get("state", ""))
    redirect_uri = state_data.get("redirect_uri")
    if not redirect_uri:
        backend_url = _infer_backend_url(request)
        redirect_uri = f"{backend_url.rstrip('/')}/auth/google/callback"

    try:
        flow = _get_flow(redirect_uri)
        flow.fetch_token(code=code)
        creds = flow.credentials
        
        # Save credentials to environment variable / file
        # In a real production app, you might save this to DB or Secrets Manager.
        # For this setup, we'll try to print it and maybe update .env if possible or just rely on in-memory/file if configured

        token_json = creds.to_json()
        save_token_json(token_json)

        # Redirect back to settings page
        frontend_url = settings.frontend_url or _infer_backend_url(request)
        return RedirectResponse(f"{frontend_url.rstrip('/')}/settings.html#google")
        
    except Exception as e:
        logger.error(f"Error in callback: {e}")
        return {"error": str(e)}
