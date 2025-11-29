import sys
import os
from dotenv import load_dotenv

# Add the current directory to sys.path so we can import from backend
sys.path.append(os.getcwd())

# Load environment variables
load_dotenv()

from backend.google_auth import get_google_credentials
import logging

if __name__ == "__main__":
    print("Starting Google Auth Flow...")
    print("This will attempt to open a browser window for authentication.")
    print("Please ensure you are logged in with the Google account that has access to the Drive files.")
    
    try:
        creds = get_google_credentials()
        if creds:
            print("\n✅ Success! Credentials obtained.")
            print("\nCopy the following JSON and update your GOOGLE_TOKEN_JSON in .env (though the script might have already printed it inside get_google_credentials):")
            print("-" * 20)
            print(creds.to_json())
            print("-" * 20)
        else:
            print("\n❌ Failed to obtain credentials.")
    except Exception as e:
        print(f"\n❌ An error occurred: {e}")