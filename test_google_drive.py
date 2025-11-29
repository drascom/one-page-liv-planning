import os
import requests
from dotenv import load_dotenv
import json

# Load environment variables
load_dotenv()

def test_drive_connection():
    print("Testing Google Drive Integration...")
    
    # 1. Check Credentials
    token_json = os.getenv("GOOGLE_TOKEN_JSON")
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    
    if token_json:
        print("✅ GOOGLE_TOKEN_JSON found.")
    elif client_id:
        print("✅ GOOGLE_CLIENT_ID found (using Auth Flow).")
    else:
        print("❌ No Google Credentials found in .env!")
        return

    # 2. Test Fetching an Image (Mock Request to Backend)
    # You need a valid file ID to test this real-time.
    # Replace 'TEST_FILE_ID' with a real file ID from your Drive that is an image.
    test_file_id = input("Enter a valid Google Drive File ID (Image) to test: ").strip()
    
    if not test_file_id:
        print("Skipping download test.")
        return

    try:
        # Assuming backend is running locally on port 8000
        url = f"http://localhost:8000/drive-image/{test_file_id}"
        print(f"Requesting: {url}")
        
        # Note: This request might fail if your backend isn't running 
        # or if auth isn't fully set up on the backend yet.
        response = requests.get(url, stream=True)
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            print(f"✅ Success! Received {content_type}")
            print(f"✅ Image size: {len(response.content)} bytes")
        else:
            print(f"❌ Failed: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        print("Ensure your backend server is running (uvicorn backend.app:app --reload)")

if __name__ == "__main__":
    test_drive_connection()