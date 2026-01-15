import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: "V-Read",
  version: pkg.version,
  description: "Modern selective speed reading on any content",
  permissions: [
    "activeTab", 
    "scripting", 
    "storage",
    "identity"
  ],
  background: {
    service_worker: "src/background/background.js"
  },
  action: {
    default_popup: "src/popup/popup.html"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content.js"],
      css: ["styles.css"],
      all_frames: true,
      match_about_blank: true
    }
  ],
  web_accessible_resources: [
    {
      resources: ["src/text-input-tab/text-input-tab.html", "src/auth/auth.html", "src/auth/auth-callback.html", "src/fragment-manager/fragment-manager.html"],
      matches: ["<all_urls>"]
    }
  ]
})
