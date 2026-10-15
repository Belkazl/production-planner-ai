import { createHash } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const ORIGIN = "https://liftorbit.app";
const RELEASE = "seo-2026-10-15-v1";
const TITLE = "Production Planning Software for Manufacturers | LiftOrbit";
const DESCRIPTION = "LiftOrbit helps small and medium manufacturers schedule orders, machines, people and materials. Visual Gantt planning, changeovers and schedule optimization.";

// Public product facts only. Trial automation and pricing are not live yet,
// so there is deliberately no Offer, rating, review or invented price here.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": ORIGIN + "/#website",
      "url": ORIGIN + "/",
      "name": "LiftOrbit",
      "inLanguage": "en",
      "description": DESCRIPTION
    },
    {
      "@type": "WebPage",
      "@id": ORIGIN + "/#webpage",
      "url": ORIGIN + "/",
      "name": TITLE,
      "description": DESCRIPTION,
      "inLanguage": "en",
      "isPartOf": { "@id": ORIGIN + "/#website" },
      "mainEntity": { "@id": ORIGIN + "/#software" }
    },
    {
      "@type": "SoftwareApplication",
      "@id": ORIGIN + "/#software",
      "name": "LiftOrbit",
      "url": ORIGIN + "/",
      "applicationCategory": "BusinessApplication",
      "applicationSubCategory": "Production planning and scheduling software",
      "operatingSystem": "Web browser",
      "description": DESCRIPTION,
      "featureList": [
        "Visual production scheduling with Gantt charts",
        "Order quantities, priorities and production steps",
        "Machine and employee resource planning",
        "Raw-material stock, deliveries and consumption planning",
        "Machine changeover and setup-time constraints",
        "Schedule optimization and saved-plan comparison"
      ]
    }
  ]
};
const JSON_LD = JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c");
const JSON_LD_HASH = createHash("sha256").update(JSON_LD).digest("base64");
const escapeAttribute = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function replaceExactlyOnce(html, pattern, replacement) {
  const matches = html.match(pattern);
  if (!matches || matches.length !== 1) throw new Error("SEO template marker must occur exactly once: " + String(pattern));
  return html.replace(pattern, () => replacement);
}

// Render once on the server: metadata and readable product answers are in
// the initial HTML response, including for crawlers that do not run JS.
let html = await Bun.file(new URL("./index.html", import.meta.url)).text();
html = replaceExactlyOnce(html, /<title>[^<]*<\/title>/g, "<title>" + TITLE + "</title>");
html = replaceExactlyOnce(html, /<meta name="description" content="[^"]*">/g, '<meta name="description" content="' + escapeAttribute(DESCRIPTION) + '">');
html = replaceExactlyOnce(html, /<meta property="og:title" content="[^"]*">/g, '<meta property="og:title" content="' + escapeAttribute(TITLE) + '">');
html = replaceExactlyOnce(html, /<meta property="og:description" content="[^"]*">/g, '<meta property="og:description" content="' + escapeAttribute(DESCRIPTION) + '">');
html = replaceExactlyOnce(html, /<p class="hero-lede">[^<]*<\/p>/g, '<p class="hero-lede">LiftOrbit is production planning software for small and medium manufacturers. Turn orders, machines, employees and materials into a clear Gantt schedule, without endless spreadsheets.</p>');
html = replaceExactlyOnce(html, /<div class="faq-list">/g, '<div class="faq-list">\n      <details><summary>What is LiftOrbit?<span class="faq-plus"></span></summary><p>LiftOrbit is browser-based production planning and scheduling software. It brings orders, machines, employees and materials into visual Gantt schedules, includes machine changeover times, and lets you optimize and compare saved production plans.</p></details>\n      <details><summary>Who is LiftOrbit designed for?<span class="faq-plus"></span></summary><p>LiftOrbit is designed for small and medium manufacturers, including small-batch and made-to-order workshops. It focuses on production scheduling and resource constraints, rather than replacing a complete ERP system.</p></details>');
html = replaceExactlyOnce(html, /<\/head>/g, [
  '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">',
  '<meta property="og:site_name" content="LiftOrbit">',
  '<meta name="twitter:card" content="summary">',
  '<meta name="twitter:title" content="' + escapeAttribute(TITLE) + '">',
  '<meta name="twitter:description" content="' + escapeAttribute(DESCRIPTION) + '">',
  '<script type="application/ld+json">' + JSON_LD + '</script>',
  '</head>'
].join("\n  "));
const HTML_ETAG = '"' + createHash("sha256").update(html).digest("hex").slice(0, 24) + '"';

const ROBOTS = [
  "# Public marketing website. The authenticated application is a separate host.",
  "# Search engines and AI search crawlers may read this public content.",
  "User-agent: *",
  "Allow: /",
  "Disallow: /health",
  "",
  "Sitemap: " + ORIGIN + "/sitemap.xml",
  ""
].join("\n");
const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + ORIGIN + '/</loc><lastmod>2026-10-15</lastmod></url>\n</urlset>\n';
const ROUTES = new Map([
  ["/site.css", { file: "site.css", type: "text/css; charset=utf-8" }],
  ["/site.js", { file: "site.js", type: "application/javascript; charset=utf-8" }],
  ["/favicon.svg", { file: "favicon.svg", type: "image/svg+xml" }],
  ["/assets/demo/real-material-gantt.png", { file: "assets/demo/real-material-gantt.png", type: "image/png" }],
  ["/assets/demo/real-material-editor.png", { file: "assets/demo/real-material-editor.png", type: "image/png" }]
]);
const HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-liftorbit-release": RELEASE,
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-" + JSON_LD_HASH + "'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://app.liftorbit.app https://production-planner-gateway-v2-production.up.railway.app"
};
const app = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const u = new URL(req.url);
    const path = u.pathname;
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) return new Response("Method Not Allowed", { status: 405, headers: { ...HEADERS, "allow": "GET, HEAD", "x-robots-tag": "noindex" } });
    if (path === "/health") return new Response(head ? null : JSON.stringify({ ok: true, service: "prodplan-landing-v1", version: "1.1.0", release: RELEASE }), { headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    // Keep the previous Railway address usable, but consolidate the public
    // homepage under the purchased domain. Health checks never redirect.
    if ((path === "/" || path === "/index.html") && u.hostname === "prodplan-landing-v1-production.up.railway.app") return new Response(null, { status: 308, headers: { ...HEADERS, "location": ORIGIN + "/" + u.search, "cache-control": "public, max-age=3600" } });
    if (path === "/index.html") return new Response(null, { status: 308, headers: { ...HEADERS, "location": "/" + u.search, "cache-control": "public, max-age=3600" } });
    if (path === "/robots.txt" || path === "/sitemap.xml") return new Response(head ? null : path === "/robots.txt" ? ROBOTS : SITEMAP, { headers: { ...HEADERS, "content-type": path === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (path === "/") {
      const headers = { ...HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", "etag": HTML_ETAG, "link": '<' + ORIGIN + '/>; rel="canonical"' };
      if (req.headers.get("if-none-match") === HTML_ETAG) return new Response(null, { status: 304, headers });
      return new Response(head ? null : html, { status: 200, headers });
    }
    const route = ROUTES.get(path);
    if (!route) return new Response(head ? null : "Not Found", { status: 404, headers: { ...HEADERS, "x-robots-tag": "noindex" } });
    const file = Bun.file(new URL("./" + route.file, import.meta.url));
    if (!(await file.exists())) return new Response(head ? null : "Missing asset", { status: 500, headers: { ...HEADERS, "x-robots-tag": "noindex" } });
    return new Response(head ? null : file, { status: 200, headers: { ...HEADERS, "content-type": route.type, "cache-control": "public, max-age=600" } });
  },
  error(error) {
    console.error("Landing error:", error.message);
    return new Response("Internal server error", { status: 500, headers: { ...HEADERS, "x-robots-tag": "noindex" } });
  }
});
console.log("LiftOrbit landing " + RELEASE + " listening on :" + String(app.port));
