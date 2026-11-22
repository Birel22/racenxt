// Public client settings (the publishable key is safe to ship in the browser; access is enforced by row level security)
window.RNX_CONFIG = {
  url: "https://cfpbrfqdtgwpxthehpgz.supabase.co",
  key: "sb_publishable_SF_HWVKHvgvNpvstKJCkMQ_iXHb7RpC"
};
// Site path prefix: "/racenxt/" on GitHub Pages, "/" on a custom domain
window.RNX_BASE = location.hostname.endsWith("github.io") ? "/racenxt/" : "/";
