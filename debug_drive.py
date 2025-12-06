import os
import sys
from backend.google_auth import get_access_token
import requests

def test_list_files(folder_id):
    token = get_access_token()
    if not token:
        print("No token found. Please authenticate first.")
        return

    print(f"Using token: {token[:10]}...")
    
    url = "https://www.googleapis.com/drive/v3/files"
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test 1: Original params (before my fix, but with python True)
    print("\n--- Test 1: Standard params ---")
    params = {
        "q": f"'{folder_id}' in parents and trashed=false",
        "fields": "files(id,name,mimeType)",
        "pageSize": 10,
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
    }
    try:
        r = requests.get(url, headers=headers, params=params)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            files = r.json().get("files", [])
            print(f"Found {len(files)} files")
            for f in files:
                print(f" - {f['name']} ({f['id']})")
        else:
            print(r.text)
    except Exception as e:
        print(f"Error: {e}")

    # Test 2: With corpora=allDrives and string booleans (my fix)
    print("\n--- Test 2: corpora=allDrives ---")
    params = {
        "q": f"'{folder_id}' in parents and trashed=false",
        "fields": "files(id,name,mimeType)",
        "pageSize": 10,
        "supportsAllDrives": "true", # string
        "includeItemsFromAllDrives": "true", # string
        "corpora": "allDrives",
        "spaces": "drive",
    }
    try:
        r = requests.get(url, headers=headers, params=params)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            files = r.json().get("files", [])
            print(f"Found {len(files)} files")
            for f in files:
                print(f" - {f['name']} ({f['id']})")
        else:
            print(r.text)
    except Exception as e:
        print(f"Error: {e}")

def test_get_folder(folder_id):
    token = get_access_token()
    if not token:
        print("No token found.")
        return

    url = f"https://www.googleapis.com/drive/v3/files/{folder_id}"
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "fields": "id,name,mimeType,capabilities",
        "supportsAllDrives": "true"
    }
    
    print(f"\n--- Checking Folder {folder_id} ---")
    try:
        r = requests.get(url, headers=headers, params=params)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            print("Folder Metadata:", r.json())
        else:
            print("Error:", r.text)
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    folder_id = "1HSu7Ak-gf89GAgUkYEWD43X3Ddb-T5Oh"
    test_get_folder(folder_id)
    test_list_files(folder_id)