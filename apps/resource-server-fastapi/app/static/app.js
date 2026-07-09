(function () {
  const tokenEl = document.getElementById('token-data');
  if (!tokenEl) return;
  let token;
  try {
    token = JSON.parse(tokenEl.textContent);
  } catch {
    return;
  }
  sessionStorage.setItem('sa_access_token', token);

  // Decode claims for display only (no validation — server already verified).
  function decodePayload(jwt) {
    const part = jwt.split('.')[1];
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    const b64 = (part + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  }
  try {
    document.getElementById('claims').textContent =
      JSON.stringify(decodePayload(token), null, 2);
  } catch {}

  const resultEl = document.getElementById('result');
  fetch('/api/properties', { headers: { Authorization: 'Bearer ' + token } })
    .then(async (res) => {
      const body = await res.json();
      const status = res.ok ? 'Authorized' : 'Unauthorized';
      resultEl.textContent = status;
      resultEl.dataset.status = status.toLowerCase();
      resultEl.removeAttribute('data-pending');
      const note = document.createElement('p');
      note.textContent = `(${res.status} ${body.reason ?? ''})`.trim();
      resultEl.after(note);
    })
    .catch((err) => {
      resultEl.textContent = 'Unauthorized';
      resultEl.dataset.status = 'unauthorized';
      const note = document.createElement('p');
      note.textContent = String(err);
      resultEl.after(note);
    });

  document.getElementById('signout')?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('sa_access_token');
    window.location.href = '/';
  });
})();
