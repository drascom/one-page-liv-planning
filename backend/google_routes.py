from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from .auth import require_admin_user
from .google_auth import get_google_credentials
from .settings import get_settings
from google_auth_oauthlib.flow import Flow
import os
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/google", tags=["google_auth"])
settings = get_settings()

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def _get_flow(redirect_uri: str):
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
def google_login_url(request: Request, current_user: dict = Depends(require_admin_user)):
    # Determine redirect URI based on current request host or settings
    # We want to redirect back to the backend callback endpoint
    
    # Use BACKEND_URL if set, otherwise construct from request
    backend_url = settings.backend_url
    if not backend_url:
        scheme = request.url.scheme
        host = request.url.netloc
        backend_url = f"{scheme}://{host}"
    
    redirect_uri = f"{backend_url.rstrip('/')}/auth/google/callback"
    
    try:
        flow = _get_flow(redirect_uri)
        auth_url, _ = flow.authorization_url(prompt='consent')
        return {"url": auth_url}
    except Exception as e:
        logger.error(f"Failed to create flow: {e}")
        raise HTTPException(status_code=500, detail="Configuration error")

@router.get("/callback")
def google_auth_callback(request: Request, code: str):
    # This endpoint handles the redirect from Google
    
    backend_url = settings.backend_url
    if not backend_url:
        scheme = request.url.scheme
        host = request.url.netloc
        backend_url = f"{scheme}://{host}"
        
    redirect_uri = f"{backend_url.rstrip('/')}/auth/google/callback"

    try:
        flow = _get_flow(redirect_uri)
        flow.fetch_token(code=code)
        creds = flow.credentials
        
        # Save credentials to environment variable / file
        # In a real production app, you might save this to DB or Secrets Manager.
        # For this setup, we'll try to print it and maybe update .env if possible or just rely on in-memory/file if configured
        
        token_json = creds.to_json()
        
        # We can't easily update the running process environment variable persistently across restarts 
        # unless we write to .env file.
        # Let's write to .env
        _update_env_file("GOOGLE_TOKEN_JSON", token_json)
        
        # Redirect back to settings page
        frontend_url = settings.frontend_url or backend_url
        return RedirectResponse(f"{frontend_url.rstrip('/')}/settings.html#google")
        
    except Exception as e:
        logger.error(f"Error in callback: {e}")
        return {"error": str(e)}

def _update_env_file(key: str, value: str):
    env_path = settings.base_dir / ".env" if hasattr(settings, 'base_dir') else os.path.join(os.getcwd(), ".env")
    
    # Read existing
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            lines = f.readlines()
    
    # Prepare new line
    # Escape single quotes if present in JSON to avoid issues if we were using shell, 
    # but for .env usually just KEY='VALUE' works. 
    # JSON has double quotes, so wrapping in single quotes is safest.
    new_line = f"{key}='{value}'\n"
    
    # Update or Append
    key_found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(new_line)
            key_found = True
        else:
            new_lines.append(line)
            
    if not key_found:
        if new_lines and not new_lines[-1].endswith('\n'):
             new_lines[-1] += '\n'
        new_lines.append(new_line)
        
    with open(env_path, "w") as f:
        f.writelines(new_lines)