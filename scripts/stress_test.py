import requests
import random
import string
import time
import threading

API_URL = "https://liv.drascom.uk/api/v1/search"
TOKEN = ""

# ---- SETTINGS ----
INITIAL_RPS = 5       # start with 5 requests per second
STEP_RPS = 5          # increase by +5 each round
MAX_RPS = 200         # stop at 200 requests per second
ROUND_DURATION = 5    # run each RPS level for 5 seconds


def random_name():
    """Generate random name + surname."""
    first = ''.join(random.choices(string.ascii_lowercase, k=5)).capitalize()
    last = ''.join(random.choices(string.ascii_lowercase, k=7)).capitalize()
    return f"{first} {last}"


def send_request(session):
    """Send one search request."""
    name = random_name()

    try:
        r = session.get(
            API_URL,
            headers={"Authorization": f"Bearer {TOKEN}"},
            params={"full_name": name},
            timeout=5
        )
        return r.status_code
    except:
        return "ERR"


def round_test(rps):
    """Run one RPS-level test for fixed duration."""
    print(f"\n=== Testing {rps} requests/sec for {ROUND_DURATION}s ===")
    session = requests.Session()
    total = 0
    errors = 0

    end_time = time.time() + ROUND_DURATION

    while time.time() < end_time:
        threads = []
        for _ in range(rps):
            t = threading.Thread(target=lambda: None)
            t.run = lambda: None

        for _ in range(rps):
            t = threading.Thread(
                target=lambda: results.append(send_request(session))
            )
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        time.sleep(1)

    # calculate
    for r in results:
        total += 1
        if r != 200:
            errors += 1

    print(f"Sent: {total}  Errors: {errors}")


# ---- RUN TEST ----
if __name__ == "__main__":
    for rps in range(INITIAL_RPS, MAX_RPS + 1, STEP_RPS):
        results = []
        round_test(rps)
