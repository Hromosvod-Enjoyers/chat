# Simple RSA Chat

## Setup

1. Install dependencies:
   - `npm install`
2. Configure optional env vars:
   - `MASTER_PASSWORD` (default: `changeme`)
   - `COOKIE_SECRET` (default: `dev_cookie_secret`)
   - `PORT` (default: `3000`)
3. Start the server:
   - `npm start`

## Usage

- Open the app in your browser.
- Enter the passphrase to derive the local key (never sent to the server).
- Register or login with a username and password.
- Messages are encrypted in the browser with AES-GCM using a key derived from the passphrase (PBKDF2 + per-chat salt).
- The server stores only salt/IV/ciphertext and a room identifier derived from the key; the passphrase never leaves the browser.

## Notes

- AES-GCM supports longer messages; each message uses a random IV.
- For production, use HTTPS and strong secrets.
