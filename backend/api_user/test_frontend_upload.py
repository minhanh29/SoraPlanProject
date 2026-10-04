#!/usr/bin/env python3
"""
SoraPlan — Frontend Upload Client Simulator

Simulates frontend behavior when uploading a floor plan sketch/image
directly to Google Cloud Storage using a V4 Signed PUT URL.

Features:
- Takes any signed upload URL via interactive input prompt, CLI flag (--url), or positional argument.
- Parses GCS V4 signature parameters, bucket name, object path, and expiration.
- Detects expiration and can automatically generate a fresh active signed URL.
- Sends HTTP PUT with mandatory 'Content-Type' header (auto-detected or customized).
- Validates Google Cloud Storage 200 OK response and inspects GCS headers.
"""

import argparse
import datetime
import os
import sys
import time
from urllib.parse import parse_qs, urlparse
import urllib.request
import urllib.error

# ANSI Color codes for clean terminal output
GREEN = "\033[92m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Example signed URL provided by user
DEFAULT_SIGNED_URL = (
    "https://storage.googleapis.com/soraplan-assest-dev/projects/bP6qbDm3qTSkNfg0DPXgWCODZqN2/"
    "WAGyYunfsmcEiusN00ZP.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&"
    "X-Goog-Credential=firebase-adminsdk-fbsvc%40soraplan.iam.gserviceaccount.com%2F20261003%2Fauto%2Fstorage%2Fgoog4_request&"
    "X-Goog-Date=20261003T161226Z&X-Goog-Expires=900&X-Goog-SignedHeaders=content-type%3Bhost&"
    "X-Goog-Signature=a96af4604c9512ec5ba87ad9607c89c1e281d58d91336db077f5fd9f576db407b751eeaf5b4a9c1dd6e8090510a2a88c"
    "80e7d45554bec01085c25e2de1cf3a1981d1e03d70f5ca72a0564a82a9b5cc5d58e1df9d7f5a0ff166a973e23de3a87380721d5167bdb5068dd"
    "86039a096bd8719846eac0f1b9d39975a4bbde1b891baadd6d3b33f60bfa86879a5e42a83f26d6168a92b753e626f63e0b3a6c3ea21b38f46654a"
    "7e0e0a0ab6a7a8c87f3c7ddf7bfb1f8830150897d0ef963001ecc916533a14acb99d997c265bfa88ea8563ab68ce99ebe9ce2e5c1297640f50f"
    "3a9ee15cdd188422f324326d5a80aa4ae00ccc6528746018dcdf438fb566629aa88fa"
)

# Realistic fallback synthetic JPEG binary (SOI, APP0, SOF0, SOS, EOI)
MINIMAL_JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f"
    b"\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342"
    b"\xff\xc0\x00\x0b\x08\x00\x10\x00\x10\x01\x01\x11\x00"
    b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
    b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
)


def parse_signed_url_info(url: str) -> dict:
    """Parse GCS V4 Signed URL parameters and check expiration."""
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)

    path_parts = [p for p in parsed.path.split("/") if p]
    bucket = path_parts[0] if path_parts else "unknown"
    object_name = "/".join(path_parts[1:]) if len(path_parts) > 1 else ""

    date_str = qs.get("X-Goog-Date", [""])[0]
    expires_str = qs.get("X-Goog-Expires", ["900"])[0]
    signed_headers = qs.get("X-Goog-SignedHeaders", ["content-type;host"])[0]
    credential = qs.get("X-Goog-Credential", [""])[0]

    is_expired = False
    expiry_time_utc = None
    remaining_sec = 0

    if date_str:
        try:
            # Parse ISO basic format YYYYMMDDTHHMMSSZ
            start_dt = datetime.datetime.strptime(date_str, "%Y%m%dT%H%M%SZ").replace(
                tzinfo=datetime.timezone.utc
            )
            expires_sec = int(expires_str)
            expiry_time_utc = start_dt + datetime.timedelta(seconds=expires_sec)
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            remaining_sec = (expiry_time_utc - now_utc).total_seconds()
            is_expired = remaining_sec <= 0
        except Exception:
            pass

    return {
        "bucket": bucket,
        "object_name": object_name,
        "date_str": date_str,
        "expires_sec": expires_str,
        "expiry_time_utc": expiry_time_utc,
        "remaining_sec": remaining_sec,
        "is_expired": is_expired,
        "signed_headers": signed_headers,
        "credential": credential,
    }


def generate_fresh_signed_url(bucket_name: str, object_name: str, content_type: str = "image/jpeg") -> str:
    """Generate a fresh active V4 signed upload URL using project service account."""
    try:
        from google.cloud import storage

        base_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(base_dir, ".secrets/serviceAccountKey.json"),
            os.path.join(base_dir, "backend/api_user/.secrets/serviceAccountKey.json"),
            "backend/api_user/.secrets/serviceAccountKey.json",
            ".secrets/serviceAccountKey.json",
            "../backend/api_user/.secrets/serviceAccountKey.json",
        ]
        key_path = next((p for p in candidates if os.path.exists(p)), None)

        if key_path:
            client = storage.Client.from_service_account_json(key_path)
        else:
            client = storage.Client(project="soraplan")

        bucket = client.get_bucket(bucket_name)
        blob = bucket.blob(object_name)
        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(hours=2),
            method="PUT",
            content_type=content_type,
        )
        return url
    except Exception as e:
        print(f"{YELLOW}Could not auto-generate fresh URL ({e}). Using existing URL.{RESET}")
        return ""


def infer_content_type(file_path: str = None, object_name: str = "") -> str:
    """Infer appropriate Content-Type header from local file or GCS object name."""
    target = (file_path or object_name or "").lower()
    if target.endswith(".png"):
        return "image/png"
    elif target.endswith(".webp"):
        return "image/webp"
    elif target.endswith(".pdf"):
        return "application/pdf"
    elif target.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    return "image/jpeg"


def upload_file_as_frontend(
    signed_url: str,
    file_bytes: bytes,
    content_type: str = "image/jpeg",
) -> dict:
    """Simulate frontend sending HTTP PUT directly to Google Cloud Storage."""
    headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(file_bytes)),
    }

    print(f"\n{BOLD}[Frontend Simulator] Sending Direct HTTP PUT to GCS...{RESET}")
    print(f"  • Content-Type   : {content_type}")
    print(f"  • Payload Size   : {len(file_bytes):,} bytes ({len(file_bytes)/1024:.2f} KB)")

    start_time = time.time()
    req = urllib.request.Request(signed_url, data=file_bytes, headers=headers, method="PUT")

    try:
        with urllib.request.urlopen(req) as resp:
            elapsed = time.time() - start_time
            response_headers = dict(resp.headers)
            etag = response_headers.get("ETag", "N/A")
            generation = response_headers.get("x-goog-generation", "N/A")

            print(f"\n{GREEN}{BOLD}✓ HTTP {resp.status} {resp.reason} — UPLOAD SUCCESSFUL!{RESET}")
            print(f"  • Transfer Time  : {elapsed:.3f} seconds")
            print(f"  • GCS ETag       : {etag}")
            print(f"  • Generation ID  : {generation}")
            print(f"  • Stored Length  : {response_headers.get('x-goog-stored-content-length', len(file_bytes))} bytes")

            return {
                "success": True,
                "status_code": resp.status,
                "elapsed_seconds": elapsed,
                "etag": etag,
                "generation": generation,
                "headers": response_headers,
            }

    except urllib.error.HTTPError as e:
        elapsed = time.time() - start_time
        error_body = e.read().decode("utf-8", errors="replace")

        print(f"\n{RED}{BOLD}✗ HTTP {e.code} {e.reason} — GCS REJECTED UPLOAD{RESET}")
        print(f"  • Error Response:\n{error_body}")

        if "ExpiredToken" in error_body:
            print(f"\n{YELLOW}{BOLD}Diagnosis:{RESET} The signed URL expired. V4 signed PUT URLs have a TTL (e.g. 15 mins).")
            print(f"Run this script with {BOLD}--fresh{RESET} to auto-generate an active 2-hour signed URL!")

        return {
            "success": False,
            "status_code": e.code,
            "error_body": error_body,
        }


def main():
    parser = argparse.ArgumentParser(
        description="SoraPlan Frontend Upload Client Simulator for GCS V4 Signed URLs"
    )
    parser.add_argument(
        "url_pos",
        nargs="?",
        default=None,
        metavar="SIGNED_URL",
        help="Optional positional GCS V4 signed upload PUT URL",
    )
    parser.add_argument(
        "--url",
        "-u",
        default=None,
        help="GCS V4 signed upload PUT URL (flag)",
    )
    parser.add_argument(
        "--file",
        "-f",
        default=None,
        help="Optional local path to JPEG/PNG image to upload. If omitted, uses sample sketch bytes.",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Automatically generate a fresh active 2-hour signed URL if the URL is expired",
    )
    parser.add_argument(
        "--content-type",
        "-c",
        default=None,
        help="HTTP Content-Type header (defaults to auto-detected image/jpeg or image/png)",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Force interactive prompts for signed URL and image file path",
    )

    args = parser.parse_args()

    print(f"\n{BOLD}======================================================{RESET}")
    print(f"{BOLD}  SoraPlan — Frontend Cloud Storage Upload Simulator  {RESET}")
    print(f"{BOLD}======================================================{RESET}")

    # Determine signed URL from CLI positional/flag argument, stdin, or interactive prompt
    target_url = (args.url or args.url_pos or "").strip().strip("'\"")
    is_interactive_mode = args.interactive or not target_url

    if not target_url:
        # Check if URL was piped via standard input (e.g. echo "https://..." | script.py)
        if not sys.stdin.isatty():
            piped_input = sys.stdin.read().strip().strip("'\"")
            if piped_input.startswith("http"):
                target_url = piped_input
            else:
                print(f"{YELLOW}No URL found in standard input. Using default sample URL.{RESET}")
                target_url = DEFAULT_SIGNED_URL
        else:
            # Interactive terminal prompt
            print(f"\n{CYAN}{BOLD}📥 Input GCS Signed Upload URL:{RESET}")
            print(f"Paste your GCS V4 signed PUT URL below (or press Enter to use default test URL):")
            try:
                entered = input(f"{BOLD}Signed URL > {RESET}").strip().strip("'\"")
                if entered:
                    target_url = entered
                else:
                    print(f"{YELLOW}No URL entered. Using default sample URL.{RESET}")
                    target_url = DEFAULT_SIGNED_URL
            except (EOFError, KeyboardInterrupt):
                print(f"\n{YELLOW}Aborted by user.{RESET}")
                sys.exit(0)

    # Validate URL structure
    if not (target_url.startswith("http://") or target_url.startswith("https://")):
        print(f"\n{RED}{BOLD}Error:{RESET} Invalid URL format. Must start with http:// or https://")
        sys.exit(1)

    # Step 1: Parse and inspect URL
    info = parse_signed_url_info(target_url)
    print(f"\n{BLUE}[1/3] URL Inspection:{RESET}")
    print(f"  • Target Bucket   : {info['bucket']}")
    print(f"  • Object Path     : {info['object_name']}")
    print(f"  • Signed Headers  : {info['signed_headers']}")

    if info["expiry_time_utc"]:
        expiry_fmt = info["expiry_time_utc"].strftime("%Y-%m-%d %H:%M:%S UTC")
        if info["is_expired"]:
            print(f"  • Expiration Time : {RED}{expiry_fmt} (EXPIRED){RESET}")
        else:
            mins = int(info["remaining_sec"] // 60)
            print(f"  • Expiration Time : {GREEN}{expiry_fmt} (Valid for {mins} mins){RESET}")

    # Determine file to upload
    target_file = os.path.expanduser(os.path.expandvars(args.file)) if args.file else None
    if is_interactive_mode and not target_file and sys.stdin.isatty():
        try:
            print(f"\n{CYAN}{BOLD}📁 Input File Path (Optional):{RESET}")
            print("Enter path to image to upload (or press Enter to use default sample sketch):")
            user_file = input(f"{BOLD}File path > {RESET}").strip().strip("'\"")
            if user_file:
                expanded_path = os.path.expanduser(os.path.expandvars(user_file))
                if os.path.exists(expanded_path):
                    target_file = expanded_path
                else:
                    print(f"{YELLOW}Warning: File '{user_file}' not found. Using default sample image.{RESET}")
        except (EOFError, KeyboardInterrupt):
            pass

    # Infer Content-Type if not explicitly passed
    content_type = args.content_type
    if not content_type:
        content_type = infer_content_type(file_path=target_file, object_name=info["object_name"])

    # Handle expiration auto-refresh if requested
    if info["is_expired"] and args.fresh:
        print(f"\n{YELLOW}[Auto-Refresh] Minting fresh active signed URL for target object...{RESET}")
        fresh_url = generate_fresh_signed_url(info["bucket"], info["object_name"], content_type=content_type)
        if fresh_url:
            target_url = fresh_url
            print(f"{GREEN}✓ Fresh URL generated successfully!{RESET}")

    # Step 2: Prepare payload
    print(f"\n{BLUE}[2/3] Preparing File Payload:{RESET}")
    if target_file and os.path.exists(target_file):
        with open(target_file, "rb") as f:
            file_bytes = f.read()
        print(f"  • Source File     : {target_file} ({len(file_bytes):,} bytes)")
    else:
        # Check if local sample image exists in uploads directory
        base_dir = os.path.dirname(os.path.abspath(__file__))
        sample_candidates = [
            os.path.join(base_dir, "uploads/Nike-Air-Jordan-1-Bred-Toe-1 copy.jpg"),
            "backend/api_user/uploads/Nike-Air-Jordan-1-Bred-Toe-1 copy.jpg",
            "uploads/Nike-Air-Jordan-1-Bred-Toe-1 copy.jpg",
        ]
        local_sample = next((p for p in sample_candidates if os.path.exists(p)), None)
        if local_sample:
            with open(local_sample, "rb") as f:
                file_bytes = f.read()
            print(f"  • Source File     : {local_sample} (local sample image, {len(file_bytes):,} bytes)")
        else:
            file_bytes = MINIMAL_JPEG_BYTES
            print(f"  • Source File     : Synthetic JPEG blueprint sketch ({len(file_bytes):,} bytes)")

    # Step 3: Perform direct upload
    print(f"\n{BLUE}[3/3] Upload Execution:{RESET}")
    result = upload_file_as_frontend(
        signed_url=target_url,
        file_bytes=file_bytes,
        content_type=content_type,
    )

    # If initial attempt failed with ExpiredToken and --fresh was not set, offer automatic retry
    if not result["success"] and "ExpiredToken" in result.get("error_body", "") and not args.fresh:
        print(f"\n{YELLOW}Notice: Attempting automatic retry with a fresh active signed URL...{RESET}")
        fresh_url = generate_fresh_signed_url(info["bucket"], info["object_name"], content_type=content_type)
        if fresh_url:
            result = upload_file_as_frontend(
                signed_url=fresh_url,
                file_bytes=file_bytes,
                content_type=content_type,
            )

    print(f"\n{BOLD}======================================================{RESET}")
    if result["success"]:
        print(f"{GREEN}{BOLD}✓ SUCCESS: Frontend upload simulation completed perfectly!{RESET}\n")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}✗ FAILED: Upload did not complete with HTTP 200.{RESET}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
