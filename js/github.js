// Thin wrapper over the GitHub REST "contents" API.
// Every write the app makes goes through here. The token is passed in per call;
// this module never reads localStorage or touches the DOM.

import { REPO } from './config.js';

const API = 'https://api.github.com';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Encode each path segment but keep the slashes (handles spaces in filenames).
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function contentsUrl(path) {
  return `${API}/repos/${REPO.owner}/${REPO.repo}/contents/${encodePath(path)}`;
}

// --- base64 helpers ---------------------------------------------------------

// UTF-8 string -> base64 (for cards.json).
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes);
}

// base64 -> UTF-8 string.
export function base64ToUtf8(b64) {
  const clean = b64.replace(/\n/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Uint8Array -> base64 (for image uploads), chunked to avoid call-stack limits.
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// --- API calls --------------------------------------------------------------

// GET a file's metadata + content. Returns null on 404. `token` optional for
// public reads (but recommended to dodge the 60/hr unauthenticated limit).
export async function getContent(path, token) {
  const headers = token
    ? authHeaders(token)
    : { Accept: 'application/vnd.github+json' };
  const res = await fetch(`${contentsUrl(path)}?ref=${REPO.branch}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await describeError('GET', path, res));
  return res.json(); // { sha, content (base64), ... }
}

// PUT (create or update) a file. Pass `sha` to update an existing file.
export async function putFile({ path, contentBase64, message, sha, token }) {
  const body = { message, content: contentBase64, branch: REPO.branch };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeError('PUT', path, res));
  return res.json();
}

// DELETE a file (requires its current sha).
export async function deleteFile({ path, sha, message, token }) {
  const res = await fetch(contentsUrl(path), {
    method: 'DELETE',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: REPO.branch }),
  });
  if (!res.ok) throw new Error(await describeError('DELETE', path, res));
  return res.json();
}

async function describeError(method, path, res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j.message || JSON.stringify(j);
  } catch {
    detail = await res.text();
  }
  if (res.status === 401) detail += ' (check your token)';
  if (res.status === 403) detail += ' (token lacks Contents:write on this repo, or rate-limited)';
  if (res.status === 409) detail += ' (sha conflict — someone/something else changed the file)';
  return `${method} ${path} failed: ${res.status} ${detail}`;
}
