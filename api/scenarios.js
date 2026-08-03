// /api/scenarios — shared scenario library backed by Vercel Blob.
// The dashboard (index.html) calls this endpoint:
//   GET    /api/scenarios          -> [{name, id, uploadedAt}]  (list all saved sets)
//   GET    /api/scenarios?id=...   -> {name, savedAt, state}    (load one set)
//   POST   /api/scenarios          -> save {name, state}; 409 if the name already exists
//   DELETE /api/scenarios?id=...   -> delete one set
// Requires a Vercel Blob store connected to the project (BLOB_READ_WRITE_TOKEN
// is set automatically when you connect one — no manual env vars needed).

const { put, list, del } = require("@vercel/blob");

const PREFIX = "scenarios/";

function nameFromPathname(pathname) {
  let raw = pathname.slice(PREFIX.length).replace(/\.json$/, "");
  raw = raw.replace(/^\d+__/, "");   // strip the timestamp prefix used by older saves
  try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

function itemFromBlob(b) {
  return {
    id: b.pathname,
    name: nameFromPathname(b.pathname),
    uploadedAt: b.uploadedAt
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const id = req.query && req.query.id;
      const { blobs } = await list({ prefix: PREFIX });

      if (id) {
        const b = blobs.find(x => x.pathname === id);
        if (!b) return res.status(404).json({ error: "not found" });
        const r = await fetch(b.url, { cache: "no-store" });
        if (!r.ok) return res.status(502).json({ error: "blob fetch failed" });
        const doc = await r.json();
        return res.status(200).json(doc);
      }

      const items = blobs
        .map(itemFromBlob)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return res.status(200).json(items);
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = (body.name || "").trim();
      const state = body.state;
      if (!name || !state) return res.status(400).json({ error: "name and state are required" });

      const pathname = PREFIX + encodeURIComponent(name) + ".json";
      const { blobs } = await list({ prefix: PREFIX });
      if (blobs.some(b => nameFromPathname(b.pathname) === name))
        return res.status(409).json({ error: "a set with that name already exists" });

      const doc = { name, savedAt: new Date().toISOString(), state };
      await put(pathname, JSON.stringify(doc), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json"
      });
      return res.status(200).json({ ok: true, id: pathname });
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: "id is required" });
      const { blobs } = await list({ prefix: PREFIX });
      const b = blobs.find(x => x.pathname === id);
      if (!b) return res.status(404).json({ error: "not found" });
      await del(b.url);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
