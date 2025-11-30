import os
import json
import logging
from typing import Optional
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from .settings import BASE_DIR

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Scopes required for the application
# drive.file allows upload to user-selected files/folders while remaining scoped.
SCOPES = ['https://www.googleapis.com/auth/drive.file']
ENV_PATH = BASE_DIR / ".env"


def _persist_token_json(token_json: str) -> None:
    """
    Persist the OAuth token JSON to both the environment and .env file
    so refreshed tokens survive restarts and are immediately usable.
    """
    if not token_json:
        return

    os.environ["GOOGLE_TOKEN_JSON"] = token_json

    try:
        lines = []
        if ENV_PATH.exists():
            lines = ENV_PATH.read_text().splitlines()

        new_lines = []
        replaced = False
        for line in lines:
            if line.strip().startswith("GOOGLE_TOKEN_JSON="):
                new_lines.append(f"GOOGLE_TOKEN_JSON='{token_json}'")
                replaced = True
            else:
                new_lines.append(line)
        if not replaced:
            if new_lines and new_lines[-1] != "":
                new_lines.append("")
            new_lines.append(f"GOOGLE_TOKEN_JSON='{token_json}'")

        ENV_PATH.write_text("\n".join(new_lines) + "\n")
    except Exception as exc:
        logger.warning("Unable to persist Google token to .env: %s", exc)


def get_google_credentials() -> Optional[Credentials]:
    """
    Retrieves Google OAuth2 credentials.
    Uses environment variables for client configuration and token storage.
    """
    creds = None
    
    # Try to load token from environment variable
    token_json = os.getenv('GOOGLE_TOKEN_JSON')
    if token_json:
        try:
            creds = Credentials.from_authorized_user_info(json.loads(token_json), SCOPES)
        except Exception as e:
            logger.error(f"Error loading token from environment: {e}")

    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                _persist_token_json(creds.to_json())
            except Exception as e:
                logger.error(f"Error refreshing token: {e}")
                creds = None

        if not creds:
            # Check for client config in environment variables
            client_id = os.getenv('GOOGLE_CLIENT_ID')
            client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
            project_id = os.getenv('GOOGLE_PROJECT_ID')
            redirect_uris = os.getenv('GOOGLE_REDIRECT_URIS', 'http://localhost').split(',')
            auth_uri = os.getenv('GOOGLE_AUTH_URI', 'https://accounts.google.com/o/oauth2/auth')
            token_uri = os.getenv('GOOGLE_TOKEN_URI', 'https://oauth2.googleapis.com/token')
            
            if client_id and client_secret:
                client_config = {
                    "installed": {
                        "client_id": client_id,
                        "project_id": project_id,
                        "auth_uri": auth_uri,
                        "token_uri": token_uri,
                        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                        "client_secret": client_secret,
                        "redirect_uris": redirect_uris
                    }
                }
                
                try:
                    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
                    # This will open a browser window for authentication
                    # Using port 8080 to ensure the redirect URI is consistent
                    # Ensure http://localhost:8080/ is whitelisted in Google Cloud Console
                    logger.info("Opening browser for authentication. Ensure http://localhost:8080/ is whitelisted in Google Cloud Console.")
                    creds = flow.run_local_server(port=8080)
                    _persist_token_json(creds.to_json())
                except Exception as e:
                    logger.error(f"Error during OAuth flow: {e}")
                    return None
            else:
                logger.warning("Google Client ID/Secret not found in environment variables.")
                return None

        # Save the credentials for the next run (print to console to be added to ENV)
        if creds:
            _persist_token_json(creds.to_json())
            logger.info("New Google token generated and persisted.")

    return creds

def get_access_token() -> Optional[str]:
    """Helper to get just the access token string."""
    creds = get_google_credentials()
    if creds and creds.valid:
        return creds.token
    return None


def save_token_json(token_json: str) -> None:
    """Expose persistence helper for other modules."""
    _persist_token_json(token_json)
