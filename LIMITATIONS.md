# What See My Trackers can't see

1. **Server-to-server sharing is invisible.** Once a site has your data it can forward it from its own servers (for example Meta Conversions API or server-side Google Tag Manager). No browser extension can see that.
2. **Trackers disguised as the site itself.** Some trackers run on the site's own subdomain (CNAME cloaking) and look first-party. They are not counted.
3. **Unknown companies.** Domains that are not in the tracker database are shown as "unknown third party", not as trackers.
4. **Fingerprinting detection is a heuristic.** We flag scripts that read canvas, GPU or audio details, or enumerate fonts. Some legitimate uses (anti-fraud on login pages, image editors) can look the same.
5. **"Necessary" exceptions.** Some contacts with ad-tech-owned domains may be legitimate (payments, fraud prevention, video players). We show the category; you judge.
6. **Legitimate interest.** Under the IAB framework, sites may claim "legitimate interest" for some purposes even after you reject. Your receipt shows what the site recorded.
7. **Other blockers.** uBlock Origin, Brave Shields or Firefox Tracking Protection may block requests first. When the browser reports it, those show up as "blocked attempts", which still means the site tried.
8. **Before install, and very early scripts.** Cookies set before you installed the extension, and a few scripts that run before the probe loads, may be missed.
9. **Consent banners we can't read.** We read the common banner platforms (IAB TCF, GPP, OneTrust, Cookiebot, Didomi, Usercentrics, Google Consent Mode). For custom banners, use "I rejected" in the popup.
10. **Service workers and other extensions.** Requests made by a site's service worker in the background, or by other extensions, are not attributed to the page.
11. **Not legal advice.** Whether something breaks the law depends on where you are, the site, and the context. We report what your browser observed.
